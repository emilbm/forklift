/**
 * Types shared between the API and the web client.
 * Types only — this file is erased at build time, so both sides can import it directly.
 */

/** A pool of weight plates shared by several pieces of equipment. */
export interface PlatePool {
  id: number;
  name: string;
}

export type EquipmentKind =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bench'
  | 'rack'
  | 'bodyweight'
  | 'other';

export interface Equipment {
  id: number;
  name: string;
  kind: EquipmentKind;
  /** Set when this equipment is loaded from a shared plate pool (e.g. barbell + ez-bar). */
  platePoolId: number | null;
  notes: string;
}

export interface Exercise {
  id: number;
  name: string;
  notes: string;
  /** Equipment required to perform the exercise. */
  equipmentIds: number[];
}

/** One line in a regimen: an exercise with its prescribed sets and reps. */
export interface RegimenItem {
  id: number;
  exerciseId: number;
  position: number;
  sets: number;
  /** Rep target. When repsMin === repsMax the target is a fixed number. */
  repsMin: number;
  repsMax: number;
  restSeconds: number;
  notes: string;
}

export interface Regimen {
  id: number;
  name: string;
  notes: string;
  items: RegimenItem[];
}

export interface SetLog {
  id: number;
  sessionId: number;
  regimenItemId: number | null;
  /** Denormalised so history survives edits to the regimen. */
  exerciseId: number;
  setIndex: number;
  reps: number;
  weightKg: number | null;
  completedAt: string;
}

export interface Session {
  id: number;
  regimenId: number | null;
  regimenName: string;
  startedAt: string;
  endedAt: string | null;
  notes: string;
  sets: SetLog[];
}

export interface SessionSummary {
  id: number;
  regimenId: number | null;
  regimenName: string;
  startedAt: string;
  endedAt: string | null;
  setCount: number;
  totalReps: number;
  volumeKg: number;
}

/** What was done last time an exercise was performed, used to prefill the workout screen. */
export interface LastPerformance {
  exerciseId: number;
  sessionId: number;
  performedAt: string;
  sets: Array<{ setIndex: number; reps: number; weightKg: number | null }>;
}

/**
 * Why two exercises cannot be superset together.
 * `equipment` — they need the same physical item.
 * `plate-pool` — their equipment draws plates from the same pool, so the plates
 * would have to be moved between bars mid-set.
 */
export interface SupersetConflict {
  reason: 'equipment' | 'plate-pool';
  equipmentIds: number[];
  platePoolId: number | null;
  detail: string;
}
