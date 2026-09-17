import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/**
 * Storage is a single SQLite file. The dataset is one person's lifting history —
 * kilobytes per year — so a file on a mounted volume is the right size of tool,
 * and Node's built-in driver means no native module to compile.
 */
const DATA_DIR = process.env.FORKLIFT_DATA_DIR ?? resolve(process.cwd(), 'data');
const DB_PATH = process.env.FORKLIFT_DB_PATH ?? resolve(DATA_DIR, 'forklift.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * Typed query helpers. The driver hands back `Record<string, SQLOutputValue>`;
 * callers know their own row shapes, so the cast lives here rather than at every
 * call site. Prepared statements are cached, since the same handful of queries
 * runs over and over.
 */
const statementCache = new Map<string, StatementSync>();

function stmt(sql: string): StatementSync {
  let cached = statementCache.get(sql);
  if (!cached) {
    cached = db.prepare(sql);
    statementCache.set(sql, cached);
  }
  return cached;
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return stmt(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return stmt(sql).get(...params) as unknown as T | undefined;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export function run(sql: string, ...params: SQLInputValue[]): RunResult {
  const result = stmt(sql).run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Migrations are applied in order and tracked by `user_version`, so an existing
 * volume upgrades in place on restart. Only ever append to this list.
 */
const MIGRATIONS: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE plate_pools (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE equipment (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'other',
    plate_pool_id INTEGER REFERENCES plate_pools(id) ON DELETE SET NULL,
    notes         TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE exercises (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE exercise_equipment (
    exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    PRIMARY KEY (exercise_id, equipment_id)
  );

  CREATE TABLE regimens (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE,
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE regimen_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    regimen_id   INTEGER NOT NULL REFERENCES regimens(id) ON DELETE CASCADE,
    exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    sets         INTEGER NOT NULL DEFAULT 3,
    reps_min     INTEGER NOT NULL DEFAULT 8,
    reps_max     INTEGER NOT NULL DEFAULT 12,
    rest_seconds INTEGER NOT NULL DEFAULT 90,
    notes        TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_regimen_items_regimen ON regimen_items(regimen_id, position);

  CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    regimen_id   INTEGER REFERENCES regimens(id) ON DELETE SET NULL,
    regimen_name TEXT NOT NULL DEFAULT '',
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    notes        TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_sessions_started ON sessions(started_at DESC);

  CREATE TABLE set_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    regimen_item_id INTEGER REFERENCES regimen_items(id) ON DELETE SET NULL,
    exercise_id     INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    set_index       INTEGER NOT NULL,
    reps            INTEGER NOT NULL,
    weight_kg       REAL,
    completed_at    TEXT NOT NULL
  );
  CREATE INDEX idx_set_logs_session ON set_logs(session_id);
  CREATE INDEX idx_set_logs_exercise ON set_logs(exercise_id, completed_at DESC);
  `,

  // 2 — one shared plate collection instead of per-bar pools.
  //
  // Pools couldn't answer the question that actually matters: whether two loads
  // can be on the bars at once. A 60 kg deadlift and an 18.5 kg ez-bar curl
  // share a plate collection quite happily; two heavy bars do not. Deciding that
  // needs the plates owned and each bar's own weight, so both are recorded here.
  `
  CREATE TABLE plates (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    weight_kg REAL NOT NULL UNIQUE,
    count     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE equipment_v2 (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL DEFAULT 'other',
    uses_plates   INTEGER NOT NULL DEFAULT 0,
    bar_weight_kg REAL NOT NULL DEFAULT 0,
    notes         TEXT NOT NULL DEFAULT ''
  );

  INSERT INTO equipment_v2 (id, name, kind, uses_plates, bar_weight_kg, notes)
    SELECT id,
           name,
           kind,
           CASE WHEN plate_pool_id IS NOT NULL OR kind = 'barbell' THEN 1 ELSE 0 END,
           0,
           notes
      FROM equipment;

  DROP TABLE equipment;
  ALTER TABLE equipment_v2 RENAME TO equipment;
  DROP TABLE plate_pools;
  `,

  // 3 — fixed weight ladders, and supersets.
  //
  // Not everything is loaded with plates: a dumbbell rack goes 2 to 32 kg in
  // 2 kg steps, and a weight stack has its own increment. Recording the ladder
  // means the weight control can offer what exists instead of a generic step.
  //
  // `superset_with_next` links an item to the one after it. Storing the link
  // rather than a group id makes a non-contiguous group unrepresentable.
  `
  ALTER TABLE equipment ADD COLUMN increment_kg  REAL NOT NULL DEFAULT 0;
  ALTER TABLE equipment ADD COLUMN min_weight_kg REAL NOT NULL DEFAULT 0;
  ALTER TABLE equipment ADD COLUMN max_weight_kg REAL NOT NULL DEFAULT 0;

  -- A sensible starting point for existing dumbbells; editable like anything else.
  UPDATE equipment
     SET increment_kg = 2, min_weight_kg = 2, max_weight_kg = 32
   WHERE kind = 'dumbbell' AND uses_plates = 0;

  ALTER TABLE regimen_items ADD COLUMN superset_with_next INTEGER NOT NULL DEFAULT 0;
  `,

  // 4 — equipment that can be shared mid-superset, and skipping an exercise.
  //
  // Needing the same item doesn't always rule out a superset: a bench takes a
  // second to re-angle, so sharing one is fine. Only equipment that has to be
  // re-rigged — a loaded bar — actually blocks the pair.
  //
  // Skips are recorded per session rather than as a flag on the regimen: the
  // regimen is what you intend to do, a session is what happened.
  `
  ALTER TABLE equipment ADD COLUMN superset_friendly INTEGER NOT NULL DEFAULT 0;

  -- Benches and racks are the usual "just adjust it" case.
  UPDATE equipment SET superset_friendly = 1 WHERE kind IN ('bench', 'rack');

  CREATE TABLE session_skips (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    regimen_item_id INTEGER NOT NULL,
    exercise_id     INTEGER NOT NULL,
    reason          TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    UNIQUE (session_id, regimen_item_id)
  );
  CREATE INDEX idx_session_skips_session ON session_skips(session_id);
  `,

  // 5 — how an exercise felt.
  //
  // Rated once its last set is done: easy, ok or hard. Next time the exercise
  // comes round, an easy day puts one more increment on the bar — the smallest
  // useful form of progression, and one that only the lifter can judge.
  //
  // Keyed on the exercise rather than the regimen line, because that is how it
  // is read back: the same lift in a different regimen is still the same lift.
  `
  CREATE TABLE exercise_efforts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    exercise_id     INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    regimen_item_id INTEGER,
    effort          TEXT NOT NULL CHECK (effort IN ('easy', 'ok', 'hard')),
    created_at      TEXT NOT NULL,
    UNIQUE (session_id, exercise_id)
  );
  CREATE INDEX idx_exercise_efforts_session ON exercise_efforts(session_id);
  CREATE INDEX idx_exercise_efforts_exercise ON exercise_efforts(exercise_id, created_at DESC);
  `,
];

export function migrate(): void {
  const current = get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
  if (current >= MIGRATIONS.length) return;

  // Rebuilding a table means dropping one that others reference, so constraints
  // are lifted for the duration and verified once the migrations are in.
  // A PRAGMA is a no-op inside a transaction, hence outside the loop.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (let version = current; version < MIGRATIONS.length; version++) {
      const sql = MIGRATIONS[version];
      if (!sql) continue;
      tx(() => {
        db.exec(sql);
        // PRAGMA values can't be bound as parameters; version is a loop counter, not input.
        db.exec(`PRAGMA user_version = ${version + 1}`);
      });
    }

    const violations = all<{ table: string }>('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(
        `Migration left dangling references in: ${[...new Set(violations.map((v) => v.table))].join(', ')}`,
      );
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
