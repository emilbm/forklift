/**
 * Plate arithmetic. Run via `npm test`, which builds the server first.
 */
import { achievableWeights, planLoads, planSingleLoad } from '../server/dist/server/src/plates.js';

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)));
  }
}

const sides = (plan) =>
  plan === null ? null : plan.map((s) => `${s.count}x${s.weightKg}`).join('+');

/* A fairly ordinary home-gym collection: pairs of everything. */
const STOCK = [
  { weightKg: 20, count: 4 },
  { weightKg: 15, count: 2 },
  { weightKg: 10, count: 2 },
  { weightKg: 5, count: 2 },
  { weightKg: 2.5, count: 2 },
  { weightKg: 1.25, count: 2 },
];

const BARBELL = 20;
const EZBAR = 8.5;

/* ------------------------------------------------------- single loads */

check(
  'loads a 60 kg deadlift as 20 kg bar plus a pair of 20s',
  sides(planSingleLoad(BARBELL, 60, STOCK)) === '1x20',
  sides(planSingleLoad(BARBELL, 60, STOCK)),
);

check(
  'loads an 18.5 kg ez-bar as 8.5 kg bar plus a pair of 5s',
  sides(planSingleLoad(EZBAR, 18.5, STOCK)) === '1x5',
  sides(planSingleLoad(EZBAR, 18.5, STOCK)),
);

check('an empty bar needs no plates', sides(planSingleLoad(BARBELL, 20, STOCK)) === '', sides(planSingleLoad(BARBELL, 20, STOCK)));

check(
  'handles the half-kilo bar without floating-point drift',
  sides(planSingleLoad(EZBAR, 11, STOCK)) === '1x1.25',
  sides(planSingleLoad(EZBAR, 11, STOCK)),
);

check('refuses a weight below the bar', planSingleLoad(BARBELL, 15, STOCK) === null);

check(
  'refuses a weight the plates cannot make',
  planSingleLoad(BARBELL, 21, STOCK) === null,
  sides(planSingleLoad(BARBELL, 21, STOCK)),
);

check(
  'refuses more than the plates owned',
  planSingleLoad(BARBELL, 500, STOCK) === null,
  sides(planSingleLoad(BARBELL, 500, STOCK)),
);

/* ------------------------------------------- two bars at the same time */

const deadliftAndCurl = planLoads(
  [
    { key: 1, barWeightKg: BARBELL, targetKg: 60 },
    { key: 2, barWeightKg: EZBAR, targetKg: 18.5 },
  ],
  STOCK,
);
check(
  'a 60 kg deadlift and an 18.5 kg ez-bar curl can be loaded together',
  deadliftAndCurl.feasible,
  deadliftAndCurl,
);
check(
  'and each bar gets its own plates',
  sides(deadliftAndCurl.loads.find((l) => l.key === 1).perSide) === '1x20' &&
    sides(deadliftAndCurl.loads.find((l) => l.key === 2).perSide) === '1x5',
  deadliftAndCurl.loads.map((l) => sides(l.perSide)),
);

/* Both bars want the heavy plates: 100 kg needs 2 pairs of 20, 60 kg needs another. */
const twoHeavyBars = planLoads(
  [
    { key: 1, barWeightKg: BARBELL, targetKg: 100 },
    { key: 2, barWeightKg: BARBELL, targetKg: 100 },
  ],
  STOCK,
);
check('two 100 kg bars exceed the plates owned', !twoHeavyBars.feasible, twoHeavyBars.feasible);
check('and it says why', twoHeavyBars.detail.length > 0, twoHeavyBars.detail);

/* The same pair of loads becomes possible with more plates. */
const richer = [...STOCK.map((p) => ({ ...p })), { weightKg: 25, count: 4 }];
richer[0].count = 8;
const nowFeasible = planLoads(
  [
    { key: 1, barWeightKg: BARBELL, targetKg: 100 },
    { key: 2, barWeightKg: BARBELL, targetKg: 100 },
  ],
  richer,
);
check('buying more plates makes them possible', nowFeasible.feasible, nowFeasible.detail);

/* A load that needs rearranging: the greedy choice for the first bar would
   strand the second, so the solver has to back up. */
const mustBacktrack = planLoads(
  [
    { key: 1, barWeightKg: 0, targetKg: 40 }, // 20 per side: one 20, or 15+5, or 10+10...
    { key: 2, barWeightKg: 0, targetKg: 40 },
  ],
  [
    { weightKg: 20, count: 2 },
    { weightKg: 15, count: 2 },
    { weightKg: 5, count: 2 },
  ],
);
check(
  'backtracks when the obvious loading strands the other bar',
  mustBacktrack.feasible,
  mustBacktrack.loads.map((l) => sides(l.perSide)),
);

/* --------------------------------------------------- achievable weights */

const reachable = achievableWeights(BARBELL, STOCK);
check('an empty bar is achievable', reachable[0] === 20, reachable[0]);
check('includes 60 kg', reachable.includes(60));
check('includes the 2.5 kg step', reachable.includes(22.5), reachable.slice(0, 6));
check('excludes 21 kg', !reachable.includes(21));
check('is sorted ascending', reachable.every((w, i) => i === 0 || w > reachable[i - 1]));
check(
  'tops out at bar plus every plate',
  reachable.at(-1) === 20 + 2 * (2 * 20 + 15 + 10 + 5 + 2.5 + 1.25),
  reachable.at(-1),
);

check('no plates means only the bare bar', achievableWeights(BARBELL, []).join() === '20');

console.log(
  failures === 0 ? `\n${checks} plate checks passed` : `\n${failures} of ${checks} plate checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
