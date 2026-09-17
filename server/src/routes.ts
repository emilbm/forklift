import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { achievableWeights, planLoads, type PlateStock } from './plates.js';
import { equipment, exercises, plates, regimens, sessions } from './store.js';
import { sharedEquipment, supersetMatrix, type SupersetInput } from './superset.js';
import { supersetGroups } from '../../shared/plan.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const equipmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z
    .enum(['barbell', 'dumbbell', 'machine', 'cable', 'bench', 'rack', 'bodyweight', 'other'])
    .default('other'),
  usesPlates: z.boolean().default(false),
  barWeightKg: z.number().min(0).max(200).default(0),
  // A fixed ladder, for anything not loaded with plates: 0 means no ladder.
  incrementKg: z.number().min(0).max(100).default(0),
  minWeightKg: z.number().min(0).max(1000).default(0),
  maxWeightKg: z.number().min(0).max(1000).default(0),
  supersetFriendly: z.boolean().default(false),
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
        supersetWithNext: z.boolean().default(false),
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

/**
 * Supersets are alternated set for set, so two exercises needing the same
 * physical item can't be one — you'd be queueing for your own bench. Rejected
 * outright when a regimen is saved. The plate check is deliberately not enforced
 * here: it depends on the weights of the day, so it stays advice.
 */
function supersetEquipmentClash(items: Array<{ exerciseId: number; supersetWithNext: boolean }>):
  | string
  | null {
  const byId = new Map(exercises.list().map((e) => [e.id, e]));
  const named = (id: number) => byId.get(id)?.name ?? `exercise #${id}`;
  const equipmentById = new Map(equipment.list().map((e) => [e.id, e]));

  for (const group of supersetGroups(items)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = byId.get(group[i]!.exerciseId);
        const b = byId.get(group[j]!.exerciseId);
        if (!a || !b) continue;
        const shared = sharedEquipment(a, b, equipmentById);
        if (shared.length > 0) {
          const names = shared.map((id) => equipmentById.get(id)?.name ?? `#${id}`).join(', ');
          return `${named(a.id)} and ${named(b.id)} can't be supersetted — both need ${names}.`;
        }
      }
    }
  }
  return null;
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

  // Which build is running — the first thing worth knowing when something
  // behaves differently than expected on the server.
  app.get('/api/version', async () => ({
    version: process.env.FORKLIFT_VERSION ?? 'dev',
    builtAt: process.env.FORKLIFT_BUILT_AT ?? null,
  }));

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

  /**
   * Every weight this equipment can be set to: worked out from the plates for a
   * loaded bar, or read off the fixed ladder for a dumbbell rack or a stack.
   */
  app.get('/api/equipment/:id/loads', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const item = equipment.get(id);
    if (!item) return reply.status(404).send({ error: 'Equipment not found' });

    let weights: number[] = [];
    if (item.usesPlates) {
      weights = achievableWeights(item.barWeightKg, currentStock());
    } else if (item.incrementKg > 0 && item.maxWeightKg >= item.minWeightKg) {
      // Counted in hundredths to keep a 2.5 kg increment from drifting.
      const step = Math.round(item.incrementKg * 100);
      const start = Math.round(item.minWeightKg * 100);
      const end = Math.round(item.maxWeightKg * 100);
      for (let w = start; w <= end; w += step) weights.push(w / 100);
    }

    return { equipmentId: item.id, barWeightKg: item.barWeightKg, weights };
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
    const input = regimenBody.parse(req.body);
    const clash = supersetEquipmentClash(input.items);
    if (clash) return reply.status(400).send({ error: clash });
    return reply.status(201).send(regimens.create(input));
  });

  app.put('/api/regimens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = regimenBody.parse(req.body);
    const clash = supersetEquipmentClash(input.items);
    if (clash) return reply.status(400).send({ error: clash });
    const updated = regimens.update(id, input);
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

  /**
   * Pass over an exercise for this session — equipment in use, a niggle, no
   * time. It drops out of the plan and the reason is kept with the workout.
   */
  app.post('/api/sessions/:id/skips', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { regimenItemId, exerciseId, reason } = z
      .object({
        regimenItemId: z.number().int().positive(),
        exerciseId: z.number().int().positive(),
        reason: z.string().max(200).default(''),
      })
      .parse(req.body);
    if (!sessions.get(id)) return reply.status(404).send({ error: 'Session not found' });
    return reply.status(201).send(sessions.skip(id, regimenItemId, exerciseId, reason.trim()));
  });

  app.delete('/api/sessions/:id/skips/:itemId', async (req, reply) => {
    const { id, itemId } = z
      .object({
        id: z.coerce.number().int().positive(),
        itemId: z.coerce.number().int().positive(),
      })
      .parse(req.params);
    return sessions.unskip(id, itemId)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Not skipped' });
  });

  /**
   * How an exercise felt today. The next time it comes round, an easy day puts
   * one more increment on the bar — see `shared/progress.ts` for the rule.
   */
  app.post('/api/sessions/:id/efforts', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { exerciseId, regimenItemId, effort } = z
      .object({
        exerciseId: z.number().int().positive(),
        regimenItemId: z.number().int().positive().nullable().default(null),
        effort: z.enum(['easy', 'ok', 'hard']),
      })
      .parse(req.body);
    if (!sessions.get(id)) return reply.status(404).send({ error: 'Session not found' });
    return reply.status(201).send(sessions.rateEffort(id, exerciseId, regimenItemId, effort));
  });

  app.delete('/api/sessions/:id/efforts/:exerciseId', async (req, reply) => {
    const { id, exerciseId } = z
      .object({
        id: z.coerce.number().int().positive(),
        exerciseId: z.coerce.number().int().positive(),
      })
      .parse(req.params);
    return sessions.clearEffort(id, exerciseId)
      ? reply.status(204).send()
      : reply.status(404).send({ error: 'Not rated' });
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
