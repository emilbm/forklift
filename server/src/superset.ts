import type { Equipment, Exercise, SupersetConflict, SupersetPair } from '../../shared/types.js';
import { planLoads, type PlateStock } from './plates.js';

/**
 * Two exercises can be supersetted only if you can go from one to the other
 * without re-rigging anything. That rules out two cases:
 *
 *  1. They need the same physical piece of equipment.
 *  2. Their bars can't both be loaded at once from the plates you own — the
 *     plates would have to come off one bar to go on the other.
 *
 * The second case depends on the weights, not just the equipment: a 60 kg
 * deadlift (20 kg bar + 2×20) and an 18.5 kg ez-bar curl (8.5 kg bar + 2×5) sit
 * side by side quite happily, while two heavy bars will fight over the same
 * plates. Weights come from the last time each exercise was performed; with no
 * history there is nothing to check, and the pair is reported as untested
 * rather than guessed at.
 */
export interface SupersetInput {
  exercise: Exercise;
  /** Working weight to assume, from history. Null when the exercise is new. */
  weightKg: number | null;
}

export function supersetPair(
  a: SupersetInput,
  b: SupersetInput,
  equipmentById: Map<number, Equipment>,
  stock: PlateStock[],
): SupersetPair {
  const conflicts: SupersetConflict[] = [];

  for (const id of a.exercise.equipmentIds.filter((id) => b.exercise.equipmentIds.includes(id))) {
    conflicts.push({
      reason: 'equipment',
      equipmentIds: [id],
      detail: `Both exercises need ${equipmentById.get(id)?.name ?? `equipment #${id}`}.`,
    });
  }

  const platesConflict = platesCannotCoexist(a, b, equipmentById, stock);
  if (platesConflict) conflicts.push(platesConflict);

  return {
    exerciseIds: [a.exercise.id, b.exercise.id],
    compatible: conflicts.length === 0,
    conflicts,
    basis: [
      { exerciseId: a.exercise.id, weightKg: a.weightKg },
      { exerciseId: b.exercise.id, weightKg: b.weightKg },
    ],
  };
}

/** The plate-loaded bar an exercise uses, if it has one. */
function platedBar(exercise: Exercise, equipmentById: Map<number, Equipment>): Equipment | null {
  for (const id of exercise.equipmentIds) {
    const item = equipmentById.get(id);
    if (item?.usesPlates) return item;
  }
  return null;
}

function platesCannotCoexist(
  a: SupersetInput,
  b: SupersetInput,
  equipmentById: Map<number, Equipment>,
  stock: PlateStock[],
): SupersetConflict | null {
  const barA = platedBar(a.exercise, equipmentById);
  const barB = platedBar(b.exercise, equipmentById);
  if (!barA || !barB) return null; // at most one draws on the plates
  if (barA.id === barB.id) return null; // one bar can't hold two loads — already a clash
  if (a.weightKg === null || b.weightKg === null) return null; // nothing to check against

  const outcome = planLoads(
    [
      { key: a.exercise.id, barWeightKg: barA.barWeightKg, targetKg: a.weightKg },
      { key: b.exercise.id, barWeightKg: barB.barWeightKg, targetKg: b.weightKg },
    ],
    stock,
  );
  if (outcome.feasible) return null;

  return {
    reason: 'plates',
    equipmentIds: [barA.id, barB.id],
    detail:
      `Not enough plates to have ${a.weightKg} kg on the ${barA.name} and ` +
      `${b.weightKg} kg on the ${barB.name} at the same time.`,
  };
}

/** Every pair of the given exercises, annotated with whether it can be supersetted. */
export function supersetMatrix(
  exercises: SupersetInput[],
  equipmentById: Map<number, Equipment>,
  stock: PlateStock[],
): SupersetPair[] {
  const pairs: SupersetPair[] = [];
  for (let i = 0; i < exercises.length; i++) {
    for (let j = i + 1; j < exercises.length; j++) {
      pairs.push(supersetPair(exercises[i]!, exercises[j]!, equipmentById, stock));
    }
  }
  return pairs;
}
