/**
 * Moving the weight: stepping the bar, and what an easy day earns you next
 * time. Run via `npm test`, which builds shared/ first.
 */
import { nextWeightDown, nextWeightUp, suggestWeight } from '../server/dist/shared/progress.js';

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

// A plate-loaded bar: the gaps are uneven, which is the whole point of a ladder.
const BAR = [20, 22.5, 25, 30, 32.5, 40, 45, 50, 60];
// A dumbbell rack, 2 kg apart and stopping at 32.
const RACK = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];

/* ------------------------------------------------------------- stepping up */

check('steps to the next loadable weight', nextWeightUp(25, BAR, 2.5) === 30, nextWeightUp(25, BAR, 2.5));
check(
  'steps up from between two rungs',
  nextWeightUp(27.5, BAR, 2.5) === 30,
  nextWeightUp(27.5, BAR, 2.5),
);
check('stays put at the top of the ladder', nextWeightUp(60, BAR, 2.5) === 60);
check('a dumbbell goes up by two', nextWeightUp(10, RACK, 2.5) === 12);
check('stops at the heaviest dumbbell', nextWeightUp(32, RACK, 2.5) === 32);
check(
  'falls back to a plain step with no ladder',
  nextWeightUp(40, [], 2.5) === 42.5,
  nextWeightUp(40, [], 2.5),
);

/* ----------------------------------------------------------- stepping down */

check('steps to the next lower rung', nextWeightDown(30, BAR, 2.5) === 25);
check('steps down from between two rungs', nextWeightDown(27.5, BAR, 2.5) === 25);
check('stays put at the bottom of the ladder', nextWeightDown(20, BAR, 2.5) === 20);
check('falls back to a plain step downwards', nextWeightDown(40, [], 2.5) === 37.5);
check('never goes below zero', nextWeightDown(1, [], 2.5) === 0, nextWeightDown(1, [], 2.5));

// Floating point: 0.1 + 0.2 territory, on weights people actually load.
check(
  'a quarter-kilo ladder does not drift',
  nextWeightUp(21.25, [20, 21.25, 22.5], 2.5) === 22.5,
  nextWeightUp(21.25, [20, 21.25, 22.5], 2.5),
);

/* ------------------------------------------------------- what to start with */

const suggest = (lastWeightKg, effort, ladder = BAR) =>
  suggestWeight({ lastWeightKg, effort, ladder, fallbackStepKg: 2.5 });

check('easy earns one more increment', suggest(25, 'easy') === 30, suggest(25, 'easy'));
check('ok holds the weight', suggest(25, 'ok') === 25);
check('hard holds the weight too', suggest(25, 'hard') === 25);
check('an unrated day holds the weight', suggest(25, null) === 25);
check('nothing to go on suggests nothing', suggest(null, 'easy') === null);
check(
  'easy on a dumbbell moves two kilos',
  suggest(10, 'easy', RACK) === 12,
  suggest(10, 'easy', RACK),
);
check(
  'easy at the top of the rack stays at the top',
  suggest(32, 'easy', RACK) === 32,
  suggest(32, 'easy', RACK),
);
check(
  'an unknown ladder waits rather than guessing an increment',
  suggestWeight({ lastWeightKg: 25, effort: 'easy', ladder: null, fallbackStepKg: 2.5 }) === 25,
);
check(
  'easy with no ladder at all uses the plain step',
  suggest(25, 'easy', []) === 27.5,
  suggest(25, 'easy', []),
);

console.log(
  failures === 0
    ? `\n${checks} progression checks passed`
    : `\n${failures} of ${checks} progression checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
