import type { Equipment, Exercise, SupersetConflict } from '../../shared/types.js';

/**
 * Two exercises can be supersetted only if performing them back to back needs no
 * equipment to be re-rigged. That rules out two cases:
 *
 *  1. They need the same physical piece of equipment.
 *  2. Their equipment draws plates from the same pool — a barbell and an ez-bar
 *     sharing one set of plates can't both stay loaded, so you'd be stripping and
 *     re-loading plates between every set.
 */
export function supersetConflicts(
  a: Exercise,
  b: Exercise,
  equipmentById: Map<number, Equipment>,
): SupersetConflict[] {
  const conflicts: SupersetConflict[] = [];

  const shared = a.equipmentIds.filter((id) => b.equipmentIds.includes(id));
  for (const id of shared) {
    const item = equipmentById.get(id);
    conflicts.push({
      reason: 'equipment',
      equipmentIds: [id],
      platePoolId: item?.platePoolId ?? null,
      detail: `Both exercises need ${item?.name ?? `equipment #${id}`}.`,
    });
  }

  for (const aId of a.equipmentIds) {
    for (const bId of b.equipmentIds) {
      if (aId === bId) continue; // already reported as an equipment clash
      const aItem = equipmentById.get(aId);
      const bItem = equipmentById.get(bId);
      const pool = aItem?.platePoolId;
      if (pool == null || pool !== bItem?.platePoolId) continue;
      conflicts.push({
        reason: 'plate-pool',
        equipmentIds: [aId, bId],
        platePoolId: pool,
        detail: `${aItem?.name} and ${bItem?.name} share the same plates.`,
      });
    }
  }

  return conflicts;
}

export interface SupersetPair {
  exerciseIds: [number, number];
  compatible: boolean;
  conflicts: SupersetConflict[];
}

/** Every pair of the given exercises, annotated with whether it can be supersetted. */
export function supersetMatrix(
  exercises: Exercise[],
  equipmentById: Map<number, Equipment>,
): SupersetPair[] {
  const pairs: SupersetPair[] = [];
  for (let i = 0; i < exercises.length; i++) {
    for (let j = i + 1; j < exercises.length; j++) {
      const a = exercises[i]!;
      const b = exercises[j]!;
      const conflicts = supersetConflicts(a, b, equipmentById);
      pairs.push({ exerciseIds: [a.id, b.id], compatible: conflicts.length === 0, conflicts });
    }
  }
  return pairs;
}
