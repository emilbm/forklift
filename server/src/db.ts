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
];

export function migrate(): void {
  const current = get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;

  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    tx(() => {
      db.exec(sql);
      // PRAGMA values can't be bound as parameters; version is a loop counter, not input.
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
