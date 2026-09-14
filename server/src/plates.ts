import type { PlateSide } from '../../shared/types.js';

/**
 * Plate arithmetic against a single shared collection of plates.
 *
 * Everything here works in centi-kilos (integers) so that 1.25 kg plates and an
 * 8.5 kg ez-bar don't accumulate floating-point error.
 *
 * Bars are loaded symmetrically, so plates are consumed in pairs: owning three
 * 20 kg plates is the same as owning one usable pair.
 */

export interface PlateStock {
  weightKg: number;
  /** Individual plates owned. */
  count: number;
}

export interface LoadRequest {
  /** Identifies the load to the caller; not used in the arithmetic. */
  key: number;
  barWeightKg: number;
  targetKg: number;
}

const toCenti = (kg: number): number => Math.round(kg * 100);
const toKg = (centi: number): number => centi / 100;

interface Denomination {
  centi: number;
  pairs: number;
}

/** Usable pairs per denomination, heaviest first — the useful order for loading. */
function denominations(stock: PlateStock[]): Denomination[] {
  return stock
    .map((plate) => ({ centi: toCenti(plate.weightKg), pairs: Math.floor(plate.count / 2) }))
    .filter((d) => d.centi > 0 && d.pairs > 0)
    .sort((a, b) => b.centi - a.centi);
}

/** Per-side weight needed, or null when the target isn't reachable in principle. */
function perSideCenti(targetKg: number, barWeightKg: number): number | null {
  const remainder = toCenti(targetKg) - toCenti(barWeightKg);
  if (remainder < 0) return null;
  if (remainder % 2 !== 0) return null; // can't split unevenly across two sides
  return remainder / 2;
}

/**
 * Every per-side weight reachable from the given pairs. Bounded-knapsack reachability:
 * one pass per denomination over a boolean table of sums.
 */
function reachablePerSide(denoms: Denomination[]): boolean[] {
  const max = denoms.reduce((sum, d) => sum + d.centi * d.pairs, 0);
  const reachable = new Array<boolean>(max + 1).fill(false);
  reachable[0] = true;

  for (const { centi, pairs } of denoms) {
    // Walk downwards so each plate pair is only counted once per iteration.
    for (let sum = max; sum >= 0; sum--) {
      if (!reachable[sum]) continue;
      for (let used = 1; used <= pairs; used++) {
        const next = sum + centi * used;
        if (next > max) break;
        reachable[next] = true;
      }
    }
  }
  return reachable;
}

/** Every total weight this bar can be loaded to, ascending, using all the plates. */
export function achievableWeights(barWeightKg: number, stock: PlateStock[]): number[] {
  const reachable = reachablePerSide(denominations(stock));
  const bar = toCenti(barWeightKg);
  const weights: number[] = [];
  for (let sum = 0; sum < reachable.length; sum++) {
    if (reachable[sum]) weights.push(toKg(bar + sum * 2));
  }
  return weights;
}

/**
 * Distinct plate combinations reaching `target` per side, drawn from `available`.
 * Heaviest-first, so the first results are the ones anyone would actually load.
 */
function* combinations(
  target: number,
  denoms: Denomination[],
  available: number[],
  index = 0,
  chosen: number[] = [],
): Generator<number[]> {
  if (target === 0) {
    yield [...chosen, ...new Array(denoms.length - chosen.length).fill(0)];
    return;
  }
  if (index >= denoms.length) return;

  const { centi } = denoms[index]!;
  const most = Math.min(available[index]!, Math.floor(target / centi));
  for (let used = most; used >= 0; used--) {
    chosen[index] = used;
    yield* combinations(target - centi * used, denoms, available, index + 1, chosen);
  }
  chosen[index] = 0;
}

function asSides(counts: number[], denoms: Denomination[]): PlateSide[] {
  return denoms
    .map((d, i) => ({ weightKg: toKg(d.centi), count: counts[i] ?? 0 }))
    .filter((side) => side.count > 0);
}

export interface SolvedLoad {
  key: number;
  targetKg: number;
  barWeightKg: number;
  perSide: PlateSide[] | null;
}

export interface PlanOutcome {
  feasible: boolean;
  loads: SolvedLoad[];
  detail: string;
}

/**
 * Can all these loads sit on their bars at once, drawing from one plate collection?
 *
 * Searches combinations for the first load, then recurses on what's left. The
 * search space is small in practice — a home gym has a handful of denominations
 * and a couple of bars — and it is capped so a pathological inventory can't hang
 * a request.
 */
export function planLoads(requests: LoadRequest[], stock: PlateStock[]): PlanOutcome {
  const denoms = denominations(stock);
  const available = denoms.map((d) => d.pairs);

  // Loads needing no plates never compete for them.
  const plated = requests.filter((r) => perSideCenti(r.targetKg, r.barWeightKg) !== 0);
  const trivial = requests.filter((r) => perSideCenti(r.targetKg, r.barWeightKg) === 0);

  const targets = plated.map((r) => ({ request: r, centi: perSideCenti(r.targetKg, r.barWeightKg) }));
  const impossible = targets.find((t) => t.centi === null);
  if (impossible) {
    return {
      feasible: false,
      loads: requests.map((r) => ({
        key: r.key,
        targetKg: r.targetKg,
        barWeightKg: r.barWeightKg,
        perSide: null,
      })),
      detail: `${impossible.request.targetKg} kg can't be split evenly over a ${impossible.request.barWeightKg} kg bar.`,
    };
  }

  // Heaviest load first: it is the most constrained, so failures surface sooner.
  const ordered = [...targets].sort((a, b) => (b.centi ?? 0) - (a.centi ?? 0));

  let steps = 0;
  const STEP_LIMIT = 200_000;
  const solution = new Map<number, PlateSide[]>();

  const search = (position: number, remaining: number[]): boolean => {
    if (position >= ordered.length) return true;
    const { request, centi } = ordered[position]!;

    for (const counts of combinations(centi!, denoms, remaining)) {
      if (++steps > STEP_LIMIT) return false;
      const next = remaining.map((pairs, i) => pairs - (counts[i] ?? 0));
      solution.set(request.key, asSides(counts, denoms));
      if (search(position + 1, next)) return true;
      solution.delete(request.key);
    }
    return false;
  };

  const feasible = search(0, available);

  const loads: SolvedLoad[] = requests.map((r) => ({
    key: r.key,
    targetKg: r.targetKg,
    barWeightKg: r.barWeightKg,
    perSide: trivial.includes(r) ? [] : (solution.get(r.key) ?? null),
  }));

  return {
    feasible,
    loads,
    detail: feasible
      ? ''
      : requests.length > 1
        ? "Your plates can't make all these loads at the same time."
        : "That weight can't be made from the plates you have.",
  };
}

/** Convenience wrapper for a single bar. */
export function planSingleLoad(
  barWeightKg: number,
  targetKg: number,
  stock: PlateStock[],
): PlateSide[] | null {
  return planLoads([{ key: 0, barWeightKg, targetKg }], stock).loads[0]?.perSide ?? null;
}
