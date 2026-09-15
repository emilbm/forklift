/**
 * Superset ordering: which set comes next, and where the rest goes.
 * Run via `npm test`, which builds the server (and with it shared/) first.
 */
import { currentStepIndex, planWorkout, supersetGroups } from '../server/dist/shared/plan.js';

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

let nextId = 1;
const item = (name, sets, supersetWithNext = false, restSeconds = 90) => ({
  id: nextId++,
  name,
  exerciseId: nextId,
  position: 0,
  sets,
  repsMin: 8,
  repsMax: 12,
  restSeconds,
  supersetWithNext,
  notes: '',
});

/** "A1" = first set of A; "A1*" marks a rest after it. */
const trace = (steps) =>
  steps.map((s) => `${s.item.name}${s.setIndex + 1}${s.restSeconds > 0 ? '*' : ''}`).join(' ');

/* ------------------------------------------------------------- grouping */

{
  const a = item('A', 3, true);
  const b = item('B', 3);
  const c = item('C', 3);
  const groups = supersetGroups([a, b, c]);
  check(
    'links an item to the one after it',
    groups.length === 2 && groups[0].length === 2 && groups[1].length === 1,
    groups.map((g) => g.map((i) => i.name)),
  );
}

{
  // A link on the final item has nothing to link to.
  const groups = supersetGroups([item('A', 3), item('B', 3, true)]);
  check(
    'ignores a link on the last item',
    groups.length === 2,
    groups.map((g) => g.map((i) => i.name)),
  );
}

{
  const groups = supersetGroups([item('A', 3, true), item('B', 3, true), item('C', 3)]);
  check('chains three into one group', groups.length === 1 && groups[0].length === 3, groups.length);
}

/* ------------------------------------------------------------- ordering */

{
  const steps = planWorkout([item('A', 3), item('B', 2)]);
  check(
    'runs ordinary exercises straight through, resting after every set',
    trace(steps) === 'A1* A2* A3* B1* B2',
    trace(steps),
  );
  check(
    'rests when moving on to the next exercise',
    steps[2].restSeconds === 90,
    steps[2].restSeconds,
  );
  check(
    'takes no rest after the very last set of the workout',
    steps.at(-1).restSeconds === 0,
    steps.at(-1).restSeconds,
  );
}

{
  const steps = planWorkout([item('A', 3, true), item('B', 3)]);
  check(
    'alternates a superset set for set',
    trace(steps) === 'A1 B1* A2 B2* A3 B3',
    trace(steps),
  );
  check(
    'takes no rest between the two halves of a round',
    steps[0].restSeconds === 0 && steps[2].restSeconds === 0,
    steps.map((s) => s.restSeconds),
  );
  check(
    'rests once the round is done',
    steps[1].restSeconds === 90 && steps[3].restSeconds === 90,
    steps.map((s) => s.restSeconds),
  );
  check(
    'takes no rest after the very last set',
    steps.at(-1).restSeconds === 0,
    steps.at(-1).restSeconds,
  );
}

{
  // A superset followed by something else still rests before moving on.
  const steps = planWorkout([item('A', 2, true), item('B', 2), item('C', 1)]);
  check(
    'rests between a finished superset and the next exercise',
    trace(steps) === 'A1 B1* A2 B2* C1',
    trace(steps),
  );
}

{
  // Uneven set counts: the shorter exercise drops out of the last round.
  const steps = planWorkout([item('A', 3, true), item('B', 2)]);
  check(
    'drops an exercise out of rounds once its sets are done',
    trace(steps) === 'A1 B1* A2 B2* A3',
    trace(steps),
  );
}

{
  const steps = planWorkout([item('A', 2, true), item('B', 2, true), item('C', 2)]);
  check('rotates a group of three', trace(steps) === 'A1 B1 C1* A2 B2 C2', trace(steps));
}

{
  const a = item('A', 2, true, 60);
  const b = item('B', 2, false, 120);
  const steps = planWorkout([a, b]);
  check(
    "rests for the length set on the round's last exercise",
    steps[1].restSeconds === 120,
    steps.map((s) => s.restSeconds),
  );
}

{
  const steps = planWorkout([]);
  check('handles an empty regimen', steps.length === 0, steps.length);
}

/* --------------------------------------------------------------- skipping */

{
  const a = item('A', 3);
  const b = item('B', 3);
  const steps = planWorkout([a, b], { skippedItemIds: new Set([a.id]) });
  check('leaves a skipped exercise out of the plan', trace(steps) === 'B1* B2* B3', trace(steps));
}

{
  // Skipping half a superset leaves the other half as an ordinary exercise.
  const a = item('A', 2, true);
  const b = item('B', 2);
  const steps = planWorkout([a, b], { skippedItemIds: new Set([a.id]) });
  check(
    'unpairs a superset when one half is skipped',
    trace(steps) === 'B1* B2',
    trace(steps),
  );
  check('and the survivor rests normally', steps[0].restSeconds === 90, steps[0].restSeconds);
}

{
  const a = item('A', 2);
  const b = item('B', 2);
  const steps = planWorkout([a, b], { skippedItemIds: new Set([a.id, b.id]) });
  check('skipping everything leaves nothing to do', steps.length === 0, steps.length);
}

/* -------------------------------------------------------------- progress */

{
  const a = item('A', 3, true);
  const b = item('B', 3);
  const steps = planWorkout([a, b]);

  check('starts at the first step', currentStepIndex(steps, new Map()) === 0);

  check(
    'moves to the partner once the first set is logged',
    currentStepIndex(steps, new Map([[a.id, 1]])) === 1,
  );

  check(
    'comes back for the second round',
    currentStepIndex(steps, new Map([[a.id, 1], [b.id, 1]])) === 2,
  );

  check(
    'reports nothing outstanding when every set is done',
    currentStepIndex(steps, new Map([[a.id, 3], [b.id, 3]])) === -1,
  );
}

console.log(
  failures === 0 ? `\n${checks} plan checks passed` : `\n${failures} of ${checks} plan checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
