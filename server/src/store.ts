import { all, get, nowIso, run, tx } from './db.js';
import type {
  Equipment,
  EquipmentKind,
  Exercise,
  LastPerformance,
  PlatePool,
  Regimen,
  RegimenItem,
  Session,
  SessionSummary,
  SetLog,
} from '../../shared/types.js';

/* ------------------------------------------------------- row shapes */

interface EquipmentRow {
  id: number;
  name: string;
  kind: string;
  plate_pool_id: number | null;
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
  platePoolId: r.plate_pool_id,
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

/* ------------------------------------------------------- plate pools */

export const platePools = {
  list(): PlatePool[] {
    return all<PlatePool>('SELECT id, name FROM plate_pools ORDER BY name');
  },
  create(name: string): PlatePool {
    const { lastInsertRowid } = run('INSERT INTO plate_pools (name) VALUES (?)', name);
    return { id: lastInsertRowid, name };
  },
  update(id: number, name: string): PlatePool | null {
    run('UPDATE plate_pools SET name = ? WHERE id = ?', name, id);
    return get<PlatePool>('SELECT id, name FROM plate_pools WHERE id = ?', id) ?? null;
  },
  remove(id: number): boolean {
    return run('DELETE FROM plate_pools WHERE id = ?', id).changes > 0;
  },
};

/* --------------------------------------------------------- equipment */

export interface EquipmentInput {
  name: string;
  kind: EquipmentKind;
  platePoolId: number | null;
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
      'INSERT INTO equipment (name, kind, plate_pool_id, notes) VALUES (?, ?, ?, ?)',
      input.name,
      input.kind,
      input.platePoolId,
      input.notes,
    );
    return equipment.get(lastInsertRowid)!;
  },
  update(id: number, input: EquipmentInput): Equipment | null {
    run(
      'UPDATE equipment SET name = ?, kind = ?, plate_pool_id = ?, notes = ? WHERE id = ?',
      input.name,
      input.kind,
      input.platePoolId,
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
         (regimen_id, exercise_id, position, sets, reps_min, reps_max, rest_seconds, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      regimenId,
      item.exerciseId,
      index,
      item.sets,
      item.repsMin,
      item.repsMax,
      item.restSeconds,
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
    return {
      id: row.id,
      regimenId: row.regimen_id,
      regimenName: row.regimen_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      notes: row.notes,
      sets,
    };
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
