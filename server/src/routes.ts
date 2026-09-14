import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { achievableWeights, planLoads, type PlateStock } from './plates.js';
import { equipment, exercises, plates, regimens, sessions } from './store.js';
import { supersetMatrix, type SupersetInput } from './superset.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const equipmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z
    .enum(['barbell', 'dumbbell', 'machine', 'cable', 'bench', 'rack', 'bodyweight', 'other'])
    .default('other'),
  usesPlates: z.boolean().default(false),
  barWeightKg: z.number().min(0).max(200).default(0),
  notes: z.string().max(500).default(''),
});

const plateBody = z.object({
  // Quarter-kilo granularity covers every plate anyone actually owns.
  weightKg: z
    .number()
    .positive()
    .max(100)
    .refine((w) => Math.round(w * 100) % 25 === 0, 'Use steps of 0.25 kg'),
  count: z.number().int().min(0).max(99).default(0),
});

/** The plate collection in the shape the solver wants. */
const currentStock = (): PlateStock[] =>
  plates.list().map((p) => ({ weightKg: p.weightKg, count: p.count }));

const exerciseBody = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(500).default(''),
  equipmentIds: z.array(z.number().int().positive()).default([]),
});

const regimenBody = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(500).default(''),
  items: z
    .array(
      z.object({
        exerciseId: z.number().int().positive(),
        sets: z.number().int().min(1).max(20).default(3),
        repsMin: z.number().int().min(1).max(100).default(8),
        repsMax: z.number().int().min(1).max(100).default(12),
        restSeconds: z.number().int().min(0).max(600).default(90),
        notes: z.string().max(300).default(''),
      }),
    )
    .default([]),
});

const logSetBody = z.object({
  regimenItemId: z.number().int().positive().nullable().default(null),
  exerciseId: z.number().int().positive(),
  setIndex: z.number().int().min(0).max(50),
  reps: z.number().int().min(0).max(500),
  weightKg: z.number().min(0).max(1000).nullable().default(null),
});

/** SQLite extended result codes, surfaced by node:sqlite as `errcode`. */
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;

function sqliteErrorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('errcode' in err)) return null;
  const code = (err as { errcode: unknown }).errcode;
  return typeof code === 'number' ? code : null;
}

/** Status carried by an error a plugin already classified, if it is a client error. */
function clientErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return null;
  const status = (err as { statusCode: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({ error: 'Invalid request', issues: err.issues });
    }
    const sqliteCode = sqliteErrorCode(err);
    if (sqliteCode === SQLITE_CONSTRAINT_UNIQUE || sqliteCode === SQLITE_CONSTRAINT_PRIMARYKEY) {
      return reply.status(409).send({ error: 'That name is already taken' });
    }
    if (sqliteCode === SQLITE_CONSTRAINT_FOREIGNKEY) {
      return reply
        .status(400)
        .send({ error: 'References something that no longer exists — try reloading' });
    }
    // Errors raised by plugins already carry a meaningful status; keep it rather
    // than reporting someone else's 4xx as a server fault.
    const clientStatus = clientErrorStatus(err);
    if (clientStatus !== null) {
      return reply
        .status(clientStatus)
        .send({ error: err instanceof Error ? err.message : 'Request rejected' });
    }
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  /* -------------------------------------------------------------- plates */

  app.get('/api/plates', async () => plates.list());

  app.post('/api/plates', async (req, reply) => {
    const { weightKg, count } = plateBody.parse(req.body);
    return reply.status(201).send(plates.create(weightKg, count));
  });

  app.put('/api/plates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { weightKg, count } = plateBody.parse(req.body);
    const updated = plates.update(id, weightKg, count);
    return updated ?? reply.status(404).send({ error: 'Plate not found' });
  });

  app.delete('/api/plates/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return plates.remove(id)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Plate not found' });
  });

  /**
   * Which loads can be assembled, and how. With one load this is a plate
   * calculator; with several it answers whether they can be on the bars at once,
   * which is what decides a superset.
   */
  app.post('/api/loads/plan', async (req, reply) => {
    const { loads } = z
      .object({
        loads: z
          .array(
            z.object({
              equipmentId: z.number().int().positive(),
              targetKg: z.number().min(0).max(1000),
            }),
          )
          .min(1)
          .max(6),
      })
      .parse(req.body);

    const byId = new Map(equipment.list().map((e) => [e.id, e]));
    const missing = loads.find((load) => !byId.has(load.equipmentId));
    if (missing) return reply.status(404).send({ error: 'Equipment not found' });

    const outcome = planLoads(
      loads.map((load) => ({
        key: load.equipmentId,
        barWeightKg: byId.get(load.equipmentId)!.barWeightKg,
        targetKg: load.targetKg,
      })),
      currentStock(),
    );

    return {
      feasible: outcome.feasible,
      detail: outcome.detail,
      plans: outcome.loads.map((load) => ({
        equipmentId: load.key,
        targetKg: load.targetKg,
        barWeightKg: load.barWeightKg,
        perSide: load.perSide,
      })),
    };
  });

  /* ----------------------------------------------------------- equipment */

  app.get('/api/equipment', async () => equipment.list());

  app.post('/api/equipment', async (req, reply) => {
    return reply.status(201).send(equipment.create(equipmentBody.parse(req.body)));
  });

  app.put('/api/equipment/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const updated = equipment.update(id, equipmentBody.parse(req.body));
    return updated ?? reply.status(404).send({ error: 'Equipment not found' });
  });

  app.delete('/api/equipment/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return equipment.remove(id)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Equipment not found' });
  });

  /** Every weight this equipment can actually be loaded to with the plates owned. */
  app.get('/api/equipment/:id/loads', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const item = equipment.get(id);
    if (!item) return reply.status(404).send({ error: 'Equipment not found' });
    return {
      equipmentId: item.id,
      barWeightKg: item.barWeightKg,
      weights: item.usesPlates ? achievableWeights(item.barWeightKg, currentStock()) : [],
    };
  });

  /* ----------------------------------------------------------- exercises */

  app.get('/api/exercises', async () => exercises.list());

  app.post('/api/exercises', async (req, reply) => {
    return reply.status(201).send(exercises.create(exerciseBody.parse(req.body)));
  });

  app.put('/api/exercises/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const updated = exercises.update(id, exerciseBody.parse(req.body));
    return updated ?? reply.status(404).send({ error: 'Exercise not found' });
  });

  app.delete('/api/exercises/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return exercises.remove(id)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Exercise not found' });
  });

  app.get('/api/exercises/:id/last-performance', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { exclude } = z
      .object({ exclude: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    const performance = sessions.lastPerformance(id, exclude);
    return performance ?? reply.status(404).send({ error: 'No history for this exercise' });
  });

  /* ------------------------------------------------------------ regimens */

  app.get('/api/regimens', async () => regimens.list());

  app.get('/api/regimens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const regimen = regimens.get(id);
    return regimen ?? reply.status(404).send({ error: 'Regimen not found' });
  });

  app.post('/api/regimens', async (req, reply) => {
    return reply.status(201).send(regimens.create(regimenBody.parse(req.body)));
  });

  app.put('/api/regimens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const updated = regimens.update(id, regimenBody.parse(req.body));
    return updated ?? reply.status(404).send({ error: 'Regimen not found' });
  });

  app.delete('/api/regimens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return regimens.remove(id)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Regimen not found' });
  });

  /**
   * Which pairs of exercises in a regimen could be supersetted, judged on
   * equipment and on whether the plates can make both loads at once. No coaching
   * judgement — just what the gym physically allows.
   */
  app.get('/api/regimens/:id/superset-pairs', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const regimen = regimens.get(id);
    if (!regimen) return reply.status(404).send({ error: 'Regimen not found' });

    const equipmentById = new Map(equipment.list().map((e) => [e.id, e]));
    const byId = new Map(exercises.list().map((e) => [e.id, e]));

    const inRegimen: SupersetInput[] = regimen.items.flatMap((item) => {
      const exercise = byId.get(item.exerciseId);
      if (!exercise) return [];
      // Assume the heaviest weight used last time — the binding case for plates.
      const history = sessions.lastPerformance(exercise.id);
      const weights = (history?.sets ?? [])
        .map((set) => set.weightKg)
        .filter((w): w is number => w !== null);
      return [{ exercise, weightKg: weights.length > 0 ? Math.max(...weights) : null }];
    });

    return supersetMatrix(inRegimen, equipmentById, currentStock());
  });

  /* ------------------------------------------------------------ sessions */

  app.get('/api/sessions', async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(30) })
      .parse(req.query);
    return sessions.history(limit);
  });

  app.get('/api/sessions/active', async (_req, reply) => {
    const active = sessions.active();
    return active ?? reply.status(404).send({ error: 'No active session' });
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const session = sessions.get(id);
    return session ?? reply.status(404).send({ error: 'Session not found' });
  });

  app.post('/api/sessions', async (req, reply) => {
    const { regimenId } = z
      .object({ regimenId: z.number().int().positive().nullable().default(null) })
      .parse(req.body ?? {});
    if (regimenId !== null && !regimens.get(regimenId)) {
      return reply.status(404).send({ error: 'Regimen not found' });
    }
    return reply.status(201).send(sessions.start(regimenId));
  });

  app.post('/api/sessions/:id/sets', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!sessions.get(id)) return reply.status(404).send({ error: 'Session not found' });
    return reply.status(201).send(sessions.logSet(id, logSetBody.parse(req.body)));
  });

  app.delete('/api/sessions/:id/sets/:setId', async (req, reply) => {
    const { id, setId } = z
      .object({
        id: z.coerce.number().int().positive(),
        setId: z.coerce.number().int().positive(),
      })
      .parse(req.params);
    return sessions.removeSet(id, setId)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Set not found' });
  });

  app.post('/api/sessions/:id/finish', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { notes } = z.object({ notes: z.string().max(1000).optional() }).parse(req.body ?? {});
    const finished = sessions.finish(id, notes);
    return finished ?? reply.status(404).send({ error: 'Session not found' });
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return sessions.remove(id)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Session not found' });
  });
}
