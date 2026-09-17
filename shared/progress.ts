import type { Effort } from './types.js';

/**
 * Moving the weight up and down.
 *
 * Every piece of equipment has its own idea of "one more": a plate-loaded bar
 * goes up by whatever the plates can actually make, a dumbbell rack by 2 kg, a
 * stack by its own pin spacing. All of that arrives as an ascending ladder of
 * achievable weights, so stepping is a matter of finding the next rung rather
 * than adding a number and hoping it lands on something loadable.
 *
 * Pure and shared so the stepper buttons and the suggestion agree, and so both
 * can be tested without a browser.
 */

/** Weights this close together are the same rung; kilos never need finer. */
const EPSILON = 1e-9;

/**
 * The next rung above `current`. With no ladder — a free weight, or a bar whose
 * plates aren't known — it falls back to a plain step. Returns `current` when
 * there is nothing higher, which is the top of the rack.
 */
export function nextWeightUp(
  current: number,
  ladder: readonly number[],
  fallbackStepKg: number,
): number {
  if (ladder.length === 0) return current + fallbackStepKg;
  return ladder.find((weight) => weight > current + EPSILON) ?? current;
}

/** The next rung below `current`, never past zero. */
export function nextWeightDown(
  current: number,
  ladder: readonly number[],
  fallbackStepKg: number,
): number {
  if (ladder.length === 0) return Math.max(0, current - fallbackStepKg);
  for (let i = ladder.length - 1; i >= 0; i--) {
    const weight = ladder[i]!;
    if (weight < current - EPSILON) return weight;
  }
  return current;
}

export interface SuggestWeightOptions {
  /** The working weight from the last time this exercise was done. */
  lastWeightKg: number | null;
  /** How it felt that day. */
  effort: Effort | null;
  /**
   * Achievable weights, ascending. `null` means they aren't known yet — still
   * loading — in which case the weight is left where it was rather than guessed
   * at with the wrong increment.
   */
  ladder: readonly number[] | null;
  fallbackStepKg: number;
}

/**
 * What to put in the weight box before the first set.
 *
 * Last time's working weight, plus one increment if it was rated easy. Only
 * easy moves the bar: "hard" is a normal working set at the edge, and taking
 * weight off after one hard day would undo progress rather than manage it.
 */
export function suggestWeight({
  lastWeightKg,
  effort,
  ladder,
  fallbackStepKg,
}: SuggestWeightOptions): number | null {
  if (lastWeightKg === null) return null;
  if (effort !== 'easy' || ladder === null) return lastWeightKg;
  return nextWeightUp(lastWeightKg, ladder, fallbackStepKg);
}
