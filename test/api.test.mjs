/**
 * End-to-end API test. Boots the built server against a throwaway database and
 * walks the whole flow — plates, equipment, exercises, regimens, a workout and
 * its history — with particular attention to what the plates allow.
 *
 * Run with `npm test` from the repo root.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.TEST_PORT ?? 8123);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dataDir = mkdtempSync(join(tmpdir(), 'forklift-test-'));

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

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/health');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Server did not start in time');
}

const server = spawn(process.execPath, ['server/dist/server/src/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), FORKLIFT_DATA_DIR: dataDir, LOG_LEVEL: 'silent' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => (serverOutput += chunk));
server.stderr.on('data', (chunk) => (serverOutput += chunk));

function cleanup() {
  server.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite file handle briefly; a temp dir left behind is harmless.
  }
}

try {
  await waitForServer();

  /* ---------------------------------------------------- plate collection */

  const empty = await call('GET', '/plates');
  check('starts with no plates', empty.status === 200 && empty.body.length === 0, empty.body);

  const twenties = await call('POST', '/plates', { weightKg: 20, count: 4 });
  check('adds a plate denomination', twenties.status === 201, twenties);

  for (const [weightKg, count] of [
    [15, 2],
    [10, 2],
    [5, 2],
    [2.5, 2],
    [1.25, 2],
  ]) {
    const added = await call('POST', '/plates', { weightKg, count });
    if (added.status !== 201) {
      failures++;
      console.log(`  FAIL adds ${weightKg} kg plates — ` + JSON.stringify(added));
    }
  }
  checks++;
  console.log('  ok   adds the rest of the plate collection');

  const sorted = await call('GET', '/plates');
  check(
    'lists plates heaviest first',
    sorted.body.map((p) => p.weightKg).join() === '20,15,10,5,2.5,1.25',
    sorted.body.map((p) => p.weightKg),
  );

  const oddPlate = await call('POST', '/plates', { weightKg: 3.3, count: 2 });
  check('rejects an implausible plate size', oddPlate.status === 400, oddPlate.status);

  const duplicatePlate = await call('POST', '/plates', { weightKg: 20, count: 2 });
  check('rejects a duplicate denomination', duplicatePlate.status === 409, duplicatePlate.status);

  const recount = await call('PUT', `/plates/${twenties.body.id}`, { weightKg: 20, count: 4 });
  check('updates how many are owned', recount.body?.count === 4, recount.body);

  /* ------------------------------------------------------------ equipment */

  const barbell = await call('POST', '/equipment', {
    name: 'Barbell',
    kind: 'barbell',
    usesPlates: true,
    barWeightKg: 20,
  });
  const ezbar = await call('POST', '/equipment', {
    name: 'EZ-bar',
    kind: 'barbell',
    usesPlates: true,
    barWeightKg: 8.5,
  });
  const dumbbells = await call('POST', '/equipment', {
    name: 'Dumbbells',
    kind: 'dumbbell',
    incrementKg: 2,
    minWeightKg: 2,
    maxWeightKg: 32,
  });
  const bench = await call('POST', '/equipment', {
    name: 'Bench',
    kind: 'bench',
    supersetFriendly: true,
  });
  check(
    'creates equipment',
    [barbell, ezbar, dumbbells, bench].every((r) => r.status === 201),
    [barbell.status, ezbar.status, dumbbells.status, bench.status],
  );
  check(
    'records the bar weight',
    barbell.body.barWeightKg === 20 && ezbar.body.barWeightKg === 8.5,
    [barbell.body.barWeightKg, ezbar.body.barWeightKg],
  );
  check(
    'records what draws on the plates',
    barbell.body.usesPlates === true && dumbbells.body.usesPlates === false,
    [barbell.body.usesPlates, dumbbells.body.usesPlates],
  );

  const duplicate = await call('POST', '/equipment', { name: 'Barbell', kind: 'barbell' });
  check('rejects a duplicate name with 409', duplicate.status === 409, duplicate.status);

  const unnamed = await call('POST', '/equipment', { name: '', kind: 'barbell' });
  check('rejects an empty name with 400', unnamed.status === 400, unnamed.status);

  /* ------------------------------------------------------ loadable weights */

  const loads = await call('GET', `/equipment/${barbell.body.id}/loads`);
  check('reports the bare bar as loadable', loads.body?.weights?.[0] === 20, loads.body?.weights?.[0]);
  check('reports 60 kg as loadable', loads.body.weights.includes(60), true);
  check('does not report 21 kg as loadable', !loads.body.weights.includes(21), true);

  const rack = await call('GET', `/equipment/${dumbbells.body.id}/loads`);
  check(
    'walks a dumbbell rack in its own increments',
    rack.body.weights[0] === 2 && rack.body.weights[1] === 4 && rack.body.weights.at(-1) === 32,
    rack.body.weights,
  );
  check(
    'offers only whole steps of the rack',
    !rack.body.weights.includes(3) && rack.body.weights.length === 16,
    rack.body.weights.length,
  );

  const bench2 = await call('GET', `/equipment/${bench.body.id}/loads`);
  check(
    'reports nothing for equipment with neither plates nor a ladder',
    bench2.body.weights.length === 0,
    bench2.body,
  );

  const singlePlan = await call('POST', '/loads/plan', {
    loads: [{ equipmentId: barbell.body.id, targetKg: 60 }],
  });
  check(
    'plans a 60 kg bar as a pair of 20s',
    singlePlan.body?.feasible &&
      singlePlan.body.plans[0].perSide.length === 1 &&
      singlePlan.body.plans[0].perSide[0].weightKg === 20,
    singlePlan.body,
  );

  const together = await call('POST', '/loads/plan', {
    loads: [
      { equipmentId: barbell.body.id, targetKg: 60 },
      { equipmentId: ezbar.body.id, targetKg: 18.5 },
    ],
  });
  check('plans a heavy bar and a light ez-bar together', together.body?.feasible, together.body);

  const tooMuch = await call('POST', '/loads/plan', {
    loads: [
      { equipmentId: barbell.body.id, targetKg: 100 },
      { equipmentId: ezbar.body.id, targetKg: 88.5 },
    ],
  });
  check('refuses two loads that exceed the plates', tooMuch.body?.feasible === false, tooMuch.body);
  check('and explains why', (tooMuch.body?.detail ?? '').length > 0, tooMuch.body?.detail);

  const unknownEquipment = await call('POST', '/loads/plan', {
    loads: [{ equipmentId: 9999, targetKg: 60 }],
  });
  check('404s planning for unknown equipment', unknownEquipment.status === 404, unknownEquipment.status);

  /* ------------------------------------------------------------ exercises */

  const deadlift = await call('POST', '/exercises', {
    name: 'Deadlift',
    equipmentIds: [barbell.body.id],
  });
  const curl = await call('POST', '/exercises', {
    name: 'EZ-bar Curl',
    equipmentIds: [ezbar.body.id],
  });
  const row = await call('POST', '/exercises', {
    name: 'Dumbbell Row',
    equipmentIds: [dumbbells.body.id, bench.body.id],
  });
  const press = await call('POST', '/exercises', {
    name: 'Bench Press',
    equipmentIds: [barbell.body.id, bench.body.id],
  });
  check(
    'creates exercises',
    [deadlift, curl, row, press].every((r) => r.status === 201),
    [deadlift.status, curl.status, row.status, press.status],
  );
  check(
    'links equipment to an exercise',
    [...row.body.equipmentIds].sort().join() === [dumbbells.body.id, bench.body.id].sort().join(),
    row.body.equipmentIds,
  );

  const bodyweight = await call('POST', '/exercises', { name: 'Plank', equipmentIds: [] });
  check('allows an exercise with no equipment', bodyweight.status === 201, bodyweight.status);

  const ghostEquipment = await call('POST', '/exercises', {
    name: 'Ghost lift',
    equipmentIds: [9999],
  });
  check('rejects unknown equipment with 400', ghostEquipment.status === 400, ghostEquipment.status);

  /* ------------------------------------------------------------- regimens */

  const regimen = await call('POST', '/regimens', {
    name: 'A - Fullbody',
    items: [
      { exerciseId: deadlift.body.id, sets: 3, repsMin: 5, repsMax: 5, restSeconds: 120 },
      { exerciseId: press.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
      { exerciseId: row.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 },
      { exerciseId: curl.body.id, sets: 2, repsMin: 10, repsMax: 15, restSeconds: 60 },
    ],
  });
  check('creates a regimen', regimen.status === 201, regimen.status);
  check(
    'keeps regimen items in order',
    regimen.body.items.map((i) => i.position).join() === '0,1,2,3',
    regimen.body.items.map((i) => i.position),
  );
  const regimenId = regimen.body.id;

  /* ------------------------- supersets with no history to judge weights by */

  const untested = await call('GET', `/regimens/${regimenId}/superset-pairs`);
  const findPair = (pairs, a, b) =>
    pairs.find(
      (p) =>
        (p.exerciseIds[0] === a && p.exerciseIds[1] === b) ||
        (p.exerciseIds[0] === b && p.exerciseIds[1] === a),
    );

  check(
    'blocks a superset needing the same bar, with or without history',
    findPair(untested.body, deadlift.body.id, press.body.id)?.compatible === false,
    findPair(untested.body, deadlift.body.id, press.body.id),
  );
  check(
    'reports no weight basis before anything is logged',
    findPair(untested.body, deadlift.body.id, curl.body.id)?.basis.every(
      (b) => b.weightKg === null,
    ),
    findPair(untested.body, deadlift.body.id, curl.body.id)?.basis,
  );

  /* -------------------------------------------------------------- workout */

  const session = await call('POST', '/sessions', { regimenId });
  check(
    'starts a session named after the regimen',
    session.status === 201 && session.body.regimenName === 'A - Fullbody',
    session.body,
  );
  const sessionId = session.body.id;

  const active = await call('GET', '/sessions/active');
  check('finds the active session', active.body?.id === sessionId, active.status);

  for (let i = 0; i < 3; i++) {
    const logged = await call('POST', `/sessions/${sessionId}/sets`, {
      regimenItemId: regimen.body.items[0].id,
      exerciseId: deadlift.body.id,
      setIndex: i,
      reps: 5,
      weightKg: 60,
    });
    if (logged.status !== 201) {
      failures++;
      console.log('  FAIL logs a set — ' + JSON.stringify(logged));
    }
  }
  checks++;
  console.log('  ok   logs three sets');

  const curlSet = await call('POST', `/sessions/${sessionId}/sets`, {
    regimenItemId: regimen.body.items[3].id,
    exerciseId: curl.body.id,
    setIndex: 0,
    reps: 12,
    weightKg: 18.5,
  });
  check('logs a set on the ez-bar', curlSet.status === 201, curlSet.status);

  const spare = await call('POST', `/sessions/${sessionId}/sets`, {
    regimenItemId: regimen.body.items[1].id,
    exerciseId: press.body.id,
    setIndex: 0,
    reps: 10,
    weightKg: 60,
  });
  const undone = await call('DELETE', `/sessions/${sessionId}/sets/${spare.body.id}`);
  check('undoes a set', undone.status === 204, undone.status);

  const missingSession = await call('POST', '/sessions/9999/sets', {
    exerciseId: deadlift.body.id,
    setIndex: 0,
    reps: 5,
  });
  check('refuses a set on an unknown session', missingSession.status === 404, missingSession.status);

  const finished = await call('POST', `/sessions/${sessionId}/finish`, { notes: 'felt good' });
  check('finishes the session', finished.body?.endedAt !== null, finished.body?.endedAt);
  check('keeps the logged sets', finished.body.sets.length === 4, finished.body.sets.length);
  check('keeps the note', finished.body.notes === 'felt good', finished.body.notes);

  const afterFinish = await call('GET', '/sessions/active');
  check('has no active session afterwards', afterFinish.status === 404, afterFinish.status);

  /* ------------------------- supersets judged against the weights actually used */

  const judged = await call('GET', `/regimens/${regimenId}/superset-pairs`);
  const deadliftCurl = findPair(judged.body, deadlift.body.id, curl.body.id);
  check(
    'allows a 60 kg deadlift with an 18.5 kg ez-bar curl — the plates coexist',
    deadliftCurl?.compatible === true,
    deadliftCurl,
  );
  check(
    'and says which weights it judged that on',
    deadliftCurl?.basis.some((b) => b.weightKg === 60) &&
      deadliftCurl?.basis.some((b) => b.weightKg === 18.5),
    deadliftCurl?.basis,
  );

  check(
    'still blocks two exercises on the same bar',
    findPair(judged.body, deadlift.body.id, press.body.id)?.compatible === false,
    findPair(judged.body, deadlift.body.id, press.body.id),
  );
  check(
    'allows two exercises sharing only equipment marked shareable',
    findPair(judged.body, press.body.id, row.body.id)?.compatible === true,
    findPair(judged.body, press.body.id, row.body.id),
  );
  check(
    'allows exercises whose equipment never competes',
    findPair(judged.body, curl.body.id, row.body.id)?.compatible === true,
    findPair(judged.body, curl.body.id, row.body.id),
  );

  /* Take the plates away and the same pair stops working. */
  const twentyId = sorted.body.find((p) => p.weightKg === 20).id;
  await call('PUT', `/plates/${twentyId}`, { weightKg: 20, count: 0 });
  const starved = await call('GET', `/regimens/${regimenId}/superset-pairs`);
  const starvedPair = findPair(starved.body, deadlift.body.id, curl.body.id);
  check(
    'blocks the pair once the plates for it are gone',
    starvedPair?.compatible === false &&
      starvedPair.conflicts.some((c) => c.reason === 'plates'),
    starvedPair,
  );
  await call('PUT', `/plates/${twentyId}`, { weightKg: 20, count: 4 });

  /* ------------------------------------------------------ history, prefill */

  const history = await call('GET', '/sessions?limit=5');
  check(
    'summarises the session in history',
    history.body[0].setCount === 4 && history.body[0].totalReps === 27,
    history.body[0],
  );

  const last = await call('GET', `/exercises/${deadlift.body.id}/last-performance`);
  check(
    'reports the last performance for prefill',
    last.body?.sets.length === 3 && last.body.sets[0].weightKg === 60,
    last.body,
  );

  const excluded = await call(
    'GET',
    `/exercises/${deadlift.body.id}/last-performance?exclude=${sessionId}`,
  );
  check('can exclude the current session', excluded.status === 404, excluded.status);

  /* -------------------------------------------------------------- supersets */

  const supersetOk = await call('POST', '/regimens', {
    name: 'B - Supersets',
    items: [
      {
        exerciseId: curl.body.id,
        sets: 3,
        repsMin: 10,
        repsMax: 15,
        restSeconds: 60,
        supersetWithNext: true,
      },
      { exerciseId: row.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 },
    ],
  });
  check(
    'accepts a superset of exercises with separate equipment',
    supersetOk.status === 201,
    supersetOk,
  );
  check(
    'stores the link',
    supersetOk.body?.items[0].supersetWithNext === true &&
      supersetOk.body.items[1].supersetWithNext === false,
    supersetOk.body?.items.map((i) => i.supersetWithNext),
  );

  // Bench Press and Dumbbell Row share only the bench, which is marked
  // shareable, so they are allowed to pair up.
  const sharedBench = await call('POST', '/regimens', {
    name: 'C - Shared bench',
    items: [
      {
        exerciseId: press.body.id,
        sets: 3,
        repsMin: 8,
        repsMax: 12,
        restSeconds: 90,
        supersetWithNext: true,
      },
      { exerciseId: row.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 },
    ],
  });
  check(
    'allows a superset sharing equipment that is quick to hand over',
    sharedBench.status === 201,
    sharedBench,
  );

  // The barbell is not shareable: it would have to be stripped and re-loaded.
  const supersetClash = await call('POST', '/regimens', {
    name: 'D - Impossible',
    items: [
      {
        exerciseId: deadlift.body.id,
        sets: 3,
        repsMin: 5,
        repsMax: 5,
        restSeconds: 120,
        supersetWithNext: true,
      },
      { exerciseId: press.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
    ],
  });
  check(
    'refuses a superset whose exercises need the same bar',
    supersetClash.status === 400,
    supersetClash,
  );
  check(
    'and names the equipment they clash on',
    (supersetClash.body?.error ?? '').includes('Barbell'),
    supersetClash.body?.error,
  );

  const trailingLink = await call('POST', '/regimens', {
    name: 'E - Trailing link',
    items: [
      {
        exerciseId: curl.body.id,
        sets: 2,
        repsMin: 10,
        repsMax: 15,
        restSeconds: 60,
        supersetWithNext: true,
      },
    ],
  });
  check(
    'drops a link on the last item, which has nothing to link to',
    trailingLink.body?.items[0].supersetWithNext === false,
    trailingLink.body?.items,
  );

  /* ------------------------------------------------------ deleting things */

  const deletedSession = await call('DELETE', `/sessions/${sessionId}`);
  check('deletes a workout from history', deletedSession.status === 204, deletedSession.status);

  const afterDelete = await call('GET', '/sessions?limit=5');
  check('and it leaves the history', afterDelete.body.length === 0, afterDelete.body);

  const deleteAgain = await call('DELETE', `/sessions/${sessionId}`);
  check('404s deleting it twice', deleteAgain.status === 404, deleteAgain.status);

  const deleted = await call('DELETE', `/regimens/${regimenId}`);
  check('deletes a regimen', deleted.status === 204, deleted.status);

  /* Past workouts must outlive the regimen they came from. */
  const keeper = await call('POST', '/sessions', { regimenId: null });
  await call('POST', `/sessions/${keeper.body.id}/sets`, {
    exerciseId: deadlift.body.id,
    setIndex: 0,
    reps: 5,
    weightKg: 60,
  });
  await call('POST', `/sessions/${keeper.body.id}/finish`, {});
  await call('DELETE', `/exercises/${curl.body.id}`);
  const survivor = await call('GET', `/sessions/${keeper.body.id}`);
  check(
    'keeps a workout when an unrelated exercise is deleted',
    survivor.status === 200 && survivor.body.sets.length === 1,
    survivor.status,
  );

  /* ------------------------------------------------------------ skipping */

  const skipSession = await call('POST', '/sessions', { regimenId: supersetOk.body.id });
  const skipItem = supersetOk.body.items[1];

  const skipped = await call('POST', `/sessions/${skipSession.body.id}/skips`, {
    regimenItemId: skipItem.id,
    exerciseId: skipItem.exerciseId,
    reason: 'Equipment in use',
  });
  check('skips an exercise with a reason', skipped.status === 201, skipped);

  const withSkip = await call('GET', `/sessions/${skipSession.body.id}`);
  check(
    'reports the skip with the session',
    withSkip.body?.skips.length === 1 && withSkip.body.skips[0].reason === 'Equipment in use',
    withSkip.body?.skips,
  );

  const reskipped = await call('POST', `/sessions/${skipSession.body.id}/skips`, {
    regimenItemId: skipItem.id,
    exerciseId: skipItem.exerciseId,
    reason: 'Changed my mind',
  });
  const afterReskip = await call('GET', `/sessions/${skipSession.body.id}`);
  check(
    'skipping twice updates the reason rather than duplicating',
    reskipped.status === 201 &&
      afterReskip.body.skips.length === 1 &&
      afterReskip.body.skips[0].reason === 'Changed my mind',
    afterReskip.body?.skips,
  );

  const unskipped = await call(
    'DELETE',
    `/sessions/${skipSession.body.id}/skips/${skipItem.id}`,
  );
  check('puts a skipped exercise back', unskipped.status === 204, unskipped.status);

  const afterUnskip = await call('GET', `/sessions/${skipSession.body.id}`);
  check('and the skip is gone', afterUnskip.body.skips.length === 0, afterUnskip.body.skips);

  const unskipMissing = await call(
    'DELETE',
    `/sessions/${skipSession.body.id}/skips/${skipItem.id}`,
  );
  check('404s un-skipping what was not skipped', unskipMissing.status === 404, unskipMissing.status);

  const skipUnknownSession = await call('POST', '/sessions/9999/skips', {
    regimenItemId: skipItem.id,
    exerciseId: skipItem.exerciseId,
    reason: '',
  });
  check('refuses a skip on an unknown session', skipUnknownSession.status === 404, skipUnknownSession.status);

  await call('POST', `/sessions/${skipSession.body.id}/finish`, {});

  /* -------------------------------------------------------------- version */

  const version = await call('GET', '/version');
  check(
    'reports which build is running',
    version.status === 200 && typeof version.body.version === 'string',
    version.body,
  );

  /* -------------------------------------------------------- static hosting */

  const spa = await fetch(`http://127.0.0.1:${PORT}/equipment`);
  const apiMiss = await fetch(`http://127.0.0.1:${PORT}/api/nope`);
  check(
    'serves the app shell for client routes, when a client build exists',
    spa.status === 200 || spa.status === 404,
    spa.status,
  );
  check('still 404s unknown API routes', apiMiss.status === 404, apiMiss.status);
} catch (err) {
  failures++;
  console.error('\nTest run failed:', err);
  if (serverOutput) console.error('Server output:\n' + serverOutput);
} finally {
  cleanup();
}

console.log(
  failures === 0 ? `\n${checks} API checks passed` : `\n${failures} of ${checks} API checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
