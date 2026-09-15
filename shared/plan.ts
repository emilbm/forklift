import type { RegimenItem } from './types.js';

/**
 * Turns a regimen into the order its sets are actually performed in.
 *
 * Items linked with `supersetWithNext` form a group, and a group is worked in
 * rounds: A set 1, B set 1, A set 2, B set 2, and so on. There is no rest inside
 * a round — going from A to B is the point of a superset — only once the round
 * is finished. Everything else behaves as a group of one, which is the ordinary
 * one-exercise-at-a-time case.
 *
 * Pure and shared so the workout screen and the tests agree on the order.
 */

export interface WorkoutStep {
  item: RegimenItem;
  /** Which set of that exercise, 0-based. */
  setIndex: number;
  /** Items worked together; length 1 for an ordinary exercise. */
  group: RegimenItem[];
  /** Position of the group within the regimen, 0-based. */
  groupIndex: number;
  /** The round of the group, equal to setIndex. */
  round: number;
  /** Last step of this round — after it, the round's rest is due. */
  lastOfRound: boolean;
  /**
   * Rest after this step. Zero inside a round (go straight to the next
   * exercise) and zero after the group's final round (you're moving on anyway).
   */
  restSeconds: number;
}

/**
 * Contiguous runs of items linked by `supersetWithNext`.
 *
 * Generic over the item, so validation can group plain input objects that have
 * no database id yet.
 */
export function supersetGroups<T extends { supersetWithNext: boolean }>(items: T[]): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];

  items.forEach((item, index) => {
    current.push(item);
    // A link on the final item has nothing to link to, so it ends the group.
    const linked = item.supersetWithNext && index < items.length - 1;
    if (!linked) {
      groups.push(current);
      current = [];
    }
  });

  if (current.length > 0) groups.push(current);
  return groups;
}

export interface PlanOptions {
  /** Regimen items passed over for this session; they drop out of the plan. */
  skippedItemIds?: ReadonlySet<number>;
}

export function planWorkout(items: RegimenItem[], options: PlanOptions = {}): WorkoutStep[] {
  const skipped = options.skippedItemIds ?? new Set<number>();
  const steps: WorkoutStep[] = [];

  // Dropping a skipped item before grouping means its partner simply becomes an
  // ordinary exercise rather than half of a superset with nothing to alternate.
  const active = items.filter((item) => !skipped.has(item.id));

  supersetGroups(active).forEach((group, groupIndex) => {
    // Uneven set counts are allowed: an exercise simply drops out of later
    // rounds once its sets are done.
    const rounds = Math.max(...group.map((item) => item.sets), 0);

    for (let round = 0; round < rounds; round++) {
      const working = group.filter((item) => round < item.sets);
      working.forEach((item, position) => {
        const lastOfRound = position === working.length - 1;
        steps.push({
          item,
          setIndex: round,
          group,
          groupIndex,
          round,
          lastOfRound,
          // Rest after every round. The only set that never earns one is the
          // first half of a superset — going straight to the partner is the
          // whole point. The very last set of the workout is handled below.
          restSeconds: lastOfRound ? item.restSeconds : 0,
        });
      });
    }
  });

  // Nothing left to rest for once the workout is over.
  const last = steps.at(-1);
  if (last) last.restSeconds = 0;

  return steps;
}

/**
 * The first step still outstanding, given how many sets of each item are logged.
 * Returns -1 once everything is done.
 */
export function currentStepIndex(
  steps: WorkoutStep[],
  completedByItemId: Map<number, number>,
): number {
  return steps.findIndex(
    (step) => (completedByItemId.get(step.item.id) ?? 0) <= step.setIndex,
  );
}
