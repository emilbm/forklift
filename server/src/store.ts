import { all, get, nowIso, run, tx } from './db.js';
import type {
  Equipment,
  EquipmentKind,
  Exercise,
  LastPerformance,
  Plate,
  Regimen,
  RegimenItem,
  Session,
  SessionSkip,
  SessionSummary,
  SetLog,
} from '../../shared/types.js';

/* ------------------------------------------------------- row shapes */

interface EquipmentRow {
  id: number;
  name: string;
  kind: string;
  uses_plates: number;
  bar_weight_kg: number;
  increment_kg: number;
  min_weight_kg: number;
  max_weight_kg: number;
  superset_friendly: number;
  notes: string;
}

interface RegimenItemRow {
  id: number;
  exercise_id: number;
  position: number;
  sets: number;
  reps_min: number;
  reps_max: number;
  rest_seconds: number;
  superset_with_next: number;
  notes: string;
}

interface SetLogRow {
  id: number;
  session_id: number;
  regimen_item_id: number | null;
  exercise_id: number;
  set_index: number;
  reps: number;
  weight_kg: number | null;
  completed_at: string;
}

interface SessionRow {
  id: number;
  regimen_id: number | null;
  regimen_name: string;
  started_at: string;
  ended_at: string | null;
  notes: string;
}

interface NamedRow {
  id: number;
  name: string;
  notes: string;
}

const toEquipment = (r: EquipmentRow): Equipment => ({
  id: r.id,
  name: r.name,
  kind: r.kind as EquipmentKind,
  usesPlates: r.uses_plates === 1,
  barWeightKg: r.bar_weight_kg,
  incrementKg: r.increment_kg,
  minWeightKg: r.min_weight_kg,
  maxWeightKg: r.max_weight_kg,
  supersetFriendly: r.superset_friendly === 1,
  notes: r.notes,
});

const toRegimenItem = (r: RegimenItemRow): RegimenItem => ({
  id: r.id,
  exerciseId: r.exercise_id,
  position: r.position,
  sets: r.sets,
  repsMin: r.reps_min,
  repsMax: r.reps_max,
  restSeconds: r.rest_seconds,
  supersetWithNext: r.superset_with_next === 1,
  notes: r.notes,
});

const toSetLog = (r: SetLogRow): SetLog => ({
  id: r.id,
  sessionId: r.session_id,
  regimenItemId: r.regimen_item_id,
  exerciseId: r.exercise_id,
  setIndex: r.set_index,
  reps: r.reps,
  weightKg: r.weight_kg,
  completedAt: r.completed_at,
});

/* ------------------------------------------------------------ plates */

export const plates = {
  list(): Plate[] {
    return all<Plate>(
      'SELECT id, weight_kg AS weightKg, count FROM plates ORDER BY weight_kg DESC',
    );
  },
  get(id: number): Plate | null {
    return (
      get<Plate>('SELECT id, weight_kg AS weightKg, count FROM plates WHERE id = ?', id) ?? null
    );
  },
  create(weightKg: number, count: number): Plate {
    const { lastInsertRowid } = run(
      'INSERT INTO plates (weight_kg, count) VALUES (?, ?)',
      weightKg,
      count,
    );
    return plates.get(lastInsertRowid)!;
  },
  update(id: number, weightKg: number, count: number): Plate | null {
    run('UPDATE plates SET weight_kg = ?, count = ? WHERE id = ?', weightKg, count, id);
    return plates.get(id);
  },
  remove(id: number): boolean {
    return run('DELETE FROM plates WHERE id = ?', id).changes > 0;
  },
};

/* --------------------------------------------------------- equipment */

export interface EquipmentInput {
  name: string;
  kind: EquipmentKind;
  usesPlates: boolean;
  barWeightKg: number;
  incrementKg: number;
  minWeightKg: number;
  maxWeightKg: number;
  supersetFriendly: boolean;
  notes: string;
}

export const equipment = {
  list(): Equipment[] {
    return all<EquipmentRow>('SELECT * FROM equipment ORDER BY kind, name').map(toEquipment);
  },
  get(id: number): Equipment | null {
    const row = get<EquipmentRow>('SELECT * FROM equipment WHERE id = ?', id);
    return row ? toEquipment(row) : null;
  },
  create(input: EquipmentInput): Equipment {
    const { lastInsertRowid } = run(
      `INSERT INTO equipment
         (name, kind, uses_plates, bar_weight_kg, increment_kg, min_weight_kg, max_weight_kg,
          superset_friendly, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.kind,
      input.usesPlates ? 1 : 0,
      input.barWeightKg,
      input.incrementKg,
      input.minWeightKg,
      input.maxWeightKg,
      input.supersetFriendly ? 1 : 0,
      input.notes,
    );
    return equipment.get(lastInsertRowid)!;
  },
  update(id: number, input: EquipmentInput): Equipment | null {
    run(
      `UPDATE equipment
          SET name = ?, kind = ?, uses_plates = ?, bar_weight_kg = ?,
              increment_kg = ?, min_weight_kg = ?, max_weight_kg = ?,
              superset_friendly = ?, notes = ?
        WHERE id = ?`,
      input.name,
      input.kind,
      input.usesPlates ? 1 : 0,
      input.barWeightKg,
      input.incrementKg,
      input.minWeightKg,
      input.maxWeightKg,
      input.supersetFriendly ? 1 : 0,
      input.notes,
      id,
    );
    return equipment.get(id);
  },
  remove(id: number): boolean {
    return run('DELETE FROM equipment WHERE id = ?', id).changes > 0;
  },
};

/* --------------------------------------------------------- exercises */

export interface ExerciseInput {
  name: string;
  notes: string;
  equipmentIds: number[];
}

function equipmentIdsFor(exerciseId: number): number[] {
  return all<{ equipment_id: number }>(
    'SELECT equipment_id FROM exercise_equipment WHERE exercise_id = ? ORDER BY equipment_id',
    exerciseId,
  ).map((r) => r.equipment_id);
}

function linkEquipment(exerciseId: number, equipmentIds: number[]): void {
  for (const equipmentId of new Set(equipmentIds)) {
    run(
      'INSERT OR IGNORE INTO exercise_equipment (exercise_id, equipment_id) VALUES (?, ?)',
      exerciseId,
      equipmentId,
    );
  }
}

export const exercises = {
  list(): Exercise[] {
    return all<NamedRow>('SELECT id, name, notes FROM exercises ORDER BY name').map((r) => ({
      ...r,
      equipmentIds: equipmentIdsFor(r.id),
    }));
  },
  get(id: number): Exercise | null {
    const row = get<NamedRow>('SELECT id, name, notes FROM exercises WHERE id = ?', id);
    return row ? { ...row, equipmentIds: equipmentIdsFor(id) } : null;
  },
  create(input: ExerciseInput): Exercise {
    const id = tx(() => {
      const { lastInsertRowid } = run(
        'INSERT INTO exercises (name, notes) VALUES (?, ?)',
        input.name,
        input.notes,
      );
      linkEquipment(lastInsertRowid, input.equipmentIds);
      return lastInsertRowid;
    });
    return exercises.get(id)!;
  },
  update(id: number, input: ExerciseInput): Exercise | null {
    tx(() => {
      run('UPDATE exercises SET name = ?, notes = ? WHERE id = ?', input.name, input.notes, id);
      run('DELETE FROM exercise_equipment WHERE exercise_id = ?', id);
      linkEquipment(id, input.equipmentIds);
    });
    return exercises.get(id);
  },
  remove(id: number): boolean {
    return run('DELETE FROM exercises WHERE id = ?', id).changes > 0;
  },
};

/* ---------------------------------------------------------- regimens */

export interface RegimenItemInput {
  exerciseId: number;
  sets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  supersetWithNext: boolean;
  notes: string;
}

export interface RegimenInput {
  name: string;
  notes: string;
  items: RegimenItemInput[];
}

function itemsFor(regimenId: number): RegimenItem[] {
  return all<RegimenItemRow>(
    'SELECT * FROM regimen_items WHERE regimen_id = ? ORDER BY position',
    regimenId,
  ).map(toRegimenItem);
}

function insertItems(regimenId: number, items: RegimenItemInput[]): void {
  items.forEach((item, index) => {
    run(
      `INSERT INTO regimen_items
         (regimen_id, exercise_id, position, sets, reps_min, reps_max, rest_seconds,
          superset_with_next, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      regimenId,
      item.exerciseId,
      index,
      item.sets,
      item.repsMin,
      item.repsMax,
      item.restSeconds,
      // A link on the last item has nothing to link to.
      item.supersetWithNext && index < items.length - 1 ? 1 : 0,
      item.notes,
    );
  });
}

export const regimens = {
  list(): Regimen[] {
    return all<NamedRow>('SELECT id, name, notes FROM regimens ORDER BY name').map((r) => ({
      ...r,
      items: itemsFor(r.id),
    }));
  },
  get(id: number): Regimen | null {
    const row = get<NamedRow>('SELECT id, name, notes FROM regimens WHERE id = ?', id);
    return row ? { ...row, items: itemsFor(id) } : null;
  },
  create(input: RegimenInput): Regimen {
    const id = tx(() => {
      const { lastInsertRowid } = run(
        'INSERT INTO regimens (name, notes) VALUES (?, ?)',
        input.name,
        input.notes,
      );
      insertItems(lastInsertRowid, input.items);
      return lastInsertRowid;
    });
    return regimens.get(id)!;
  },
  update(id: number, input: RegimenInput): Regimen | null {
    tx(() => {
      run('UPDATE regimens SET name = ?, notes = ? WHERE id = ?', input.name, input.notes, id);
      run('DELETE FROM regimen_items WHERE regimen_id = ?', id);
      insertItems(id, input.items);
    });
    return regimens.get(id);
  },
  remove(id: number): boolean {
    return run('DELETE FROM regimens WHERE id = ?', id).changes > 0;
  },
};

/* ---------------------------------------------------------- sessions */

export interface LogSetInput {
  regimenItemId: number | null;
  exerciseId: number;
  setIndex: number;
  reps: number;
  weightKg: number | null;
}

export const sessions = {
  start(regimenId: number | null): Session {
    const regimen =
      regimenId === null
        ? undefined
        : get<{ name: string }>('SELECT name FROM regimens WHERE id = ?', regimenId);
    const { lastInsertRowid } = run(
      'INSERT INTO sessions (regimen_id, regimen_name, started_at) VALUES (?, ?, ?)',
      regimenId,
      regimen?.name ?? 'Freestyle',
      nowIso(),
    );
    return sessions.get(lastInsertRowid)!;
  },

  get(id: number): Session | null {
    const row = get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
    if (!row) return null;
    const sets = all<SetLogRow>(
      'SELECT * FROM set_logs WHERE session_id = ? ORDER BY completed_at, id',
      id,
    ).map(toSetLog);
    const skips = all<SessionSkip>(
      `SELECT id,
              session_id      AS sessionId,
              regimen_item_id AS regimenItemId,
              exercise_id     AS exerciseId,
              reason,
              created_at      AS createdAt
         FROM session_skips
        WHERE session_id = ?
        ORDER BY id`,
      id,
    );
    return {
      id: row.id,
      regimenId: row.regimen_id,
      regimenName: row.regimen_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      notes: row.notes,
      sets,
      skips,
    };
  },

  /** Pass over an exercise for this session. Skipping twice just updates why. */
  skip(sessionId: number, regimenItemId: number, exerciseId: number, reason: string): SessionSkip {
    run(
      `INSERT INTO session_skips (session_id, regimen_item_id, exercise_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (session_id, regimen_item_id)
       DO UPDATE SET reason = excluded.reason`,
      sessionId,
      regimenItemId,
      exerciseId,
      reason,
      nowIso(),
    );
    return get<SessionSkip>(
      `SELECT id,
              session_id      AS sessionId,
              regimen_item_id AS regimenItemId,
              exercise_id     AS exerciseId,
              reason,
              created_at      AS createdAt
         FROM session_skips
        WHERE session_id = ? AND regimen_item_id = ?`,
      sessionId,
      regimenItemId,
    )!;
  },

  unskip(sessionId: number, regimenItemId: number): boolean {
    return (
      run(
        'DELETE FROM session_skips WHERE session_id = ? AND regimen_item_id = ?',
        sessionId,
        regimenItemId,
      ).changes > 0
    );
  },

  /** The most recently started session that has not been finished, if any. */
  active(): Session | null {
    const row = get<{ id: number }>(
      'SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    );
    return row ? sessions.get(row.id) : null;
  },

  history(limit: number): SessionSummary[] {
    return all<SessionSummary>(
      `SELECT s.id,
              s.regimen_id   AS regimenId,
              s.regimen_name AS regimenName,
              s.started_at   AS startedAt,
              s.ended_at     AS endedAt,
              COUNT(l.id)                                         AS setCount,
              COALESCE(SUM(l.reps), 0)                            AS totalReps,
              COALESCE(SUM(l.reps * COALESCE(l.weight_kg, 0)), 0) AS volumeKg
         FROM sessions s
         LEFT JOIN set_logs l ON l.session_id = s.id
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT ?`,
      limit,
    );
  },

  logSet(sessionId: number, input: LogSetInput): SetLog {
    const { lastInsertRowid } = run(
      `INSERT INTO set_logs
         (session_id, regimen_item_id, exercise_id, set_index, reps, weight_kg, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      input.regimenItemId,
      input.exerciseId,
      input.setIndex,
      input.reps,
      input.weightKg,
      nowIso(),
    );
    return toSetLog(get<SetLogRow>('SELECT * FROM set_logs WHERE id = ?', lastInsertRowid)!);
  },

  removeSet(sessionId: number, setId: number): boolean {
    return run('DELETE FROM set_logs WHERE id = ? AND session_id = ?', setId, sessionId).changes > 0;
  },

  finish(id: number, notes?: string): Session | null {
    run(
      'UPDATE sessions SET ended_at = ?, notes = COALESCE(?, notes) WHERE id = ?',
      nowIso(),
      notes ?? null,
      id,
    );
    return sessions.get(id);
  },

  remove(id: number): boolean {
    return run('DELETE FROM sessions WHERE id = ?', id).changes > 0;
  },

  /** Sets from the last time this exercise was performed, used to prefill weights. */
  lastPerformance(exerciseId: number, excludeSessionId?: number): LastPerformance | null {
    const row = get<{ sessionId: number; performedAt: string }>(
      `SELECT session_id AS sessionId, MAX(completed_at) AS performedAt
         FROM set_logs
        WHERE exercise_id = ? AND session_id IS NOT ?
        GROUP BY session_id
        ORDER BY performedAt DESC
        LIMIT 1`,
      exerciseId,
      excludeSessionId ?? null,
    );
    if (!row) return null;

    const sets = all<{ setIndex: number; reps: number; weightKg: number | null }>(
      `SELECT set_index AS setIndex, reps, weight_kg AS weightKg
         FROM set_logs
        WHERE exercise_id = ? AND session_id = ?
        ORDER BY set_index`,
      exerciseId,
      row.sessionId,
    );
    return { exerciseId, sessionId: row.sessionId, performedAt: row.performedAt, sets };
  },
};
