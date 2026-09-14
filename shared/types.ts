/**
 * Types shared between the API and the web client.
 * Types only — this file is erased at build time, so both sides can import it directly.
 */

/**
 * One denomination in the plate collection. There is a single collection: every
 * plate-loaded bar draws from it, so what one lift is using another cannot.
 */
export interface Plate {
  id: number;
  weightKg: number;
  /** Individual plates owned. Bars load in pairs, so only whole pairs are usable. */
  count: number;
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
  /** Whether this equipment is loaded from the shared plate collection. */
  usesPlates: boolean;
  /** Weight of the bar or carriage itself, before any plates. */
  barWeightKg: number;
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

/* -------------------------------------------------------------- loading */

/** Plates to hang on one side of a bar. */
export interface PlateSide {
  weightKg: number;
  count: number;
}

/** How one bar is loaded to reach a target weight. */
export interface LoadPlan {
  equipmentId: number;
  targetKg: number;
  barWeightKg: number;
  /** Null when the target can't be made from the plates on hand. */
  perSide: PlateSide[] | null;
}

/**
 * Whether a set of loads can be on the bars at the same time. Two lifts can only
 * be supersetted if their plates can coexist — that is what makes a 60 kg
 * deadlift and an 18.5 kg ez-bar curl compatible while two heavy bars are not.
 */
export interface LoadPlanResult {
  feasible: boolean;
  plans: LoadPlan[];
  /** Present when infeasible: which loads could not be satisfied together. */
  detail: string;
}

/** Every total weight a piece of equipment can be loaded to, given the plates owned. */
export interface AchievableLoads {
  equipmentId: number;
  barWeightKg: number;
  weights: number[];
}

/**
 * Why two exercises cannot be supersetted.
 * `equipment` — they need the same physical item.
 * `plates`    — the plates on hand can't make both loads at once.
 */
export interface SupersetConflict {
  reason: 'equipment' | 'plates';
  equipmentIds: number[];
  detail: string;
}

export interface SupersetPair {
  exerciseIds: [number, number];
  compatible: boolean;
  conflicts: SupersetConflict[];
  /**
   * Weights the plate check assumed, taken from the last time each exercise was
   * performed. A null weight means there was no history to go on, so the plate
   * check was skipped for that exercise.
   */
  basis: Array<{ exerciseId: number; weightKg: number | null }>;
}
