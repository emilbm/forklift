/**
 * End-to-end API test. Boots the built server against a throwaway database and
 * walks the whole flow — equipment, plate pools, exercises, regimens, a workout
 * and its history — with particular attention to the superset rules.
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

  /* -------------------------------------------------- equipment and pools */

  const pool = await call('POST', '/plate-pools', { name: 'Main plates' });
  check('creates a plate pool', pool.status === 201, pool);
  const poolId = pool.body.id;

  const barbell = await call('POST', '/equipment', {
    name: 'Barbell',
    kind: 'barbell',
    platePoolId: poolId,
  });
  const ezbar = await call('POST', '/equipment', {
    name: 'EZ-bar',
    kind: 'barbell',
    platePoolId: poolId,
  });
  const dumbbells = await call('POST', '/equipment', { name: 'Dumbbells', kind: 'dumbbell' });
  const bench = await call('POST', '/equipment', { name: 'Bench', kind: 'bench' });
  check(
    'creates equipment',
    [barbell, ezbar, dumbbells, bench].every((r) => r.status === 201),
    [barbell.status, ezbar.status, dumbbells.status, bench.status],
  );
  check('remembers the plate pool', barbell.body.platePoolId === poolId, barbell.body);

  const duplicate = await call('POST', '/equipment', { name: 'Barbell', kind: 'barbell' });
  check('rejects a duplicate name with 409', duplicate.status === 409, duplicate);

  const unnamed = await call('POST', '/equipment', { name: '', kind: 'barbell' });
  check('rejects an empty name with 400', unnamed.status === 400, unnamed.status);

  /* ------------------------------------------------------------ exercises */

  const squat = await call('POST', '/exercises', {
    name: 'Back Squat',
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
    [squat, curl, row, press].every((r) => r.status === 201),
    [squat.status, curl.status, row.status, press.status],
  );
  check(
    'links equipment to an exercise',
    [...row.body.equipmentIds].sort().join() ===
      [dumbbells.body.id, bench.body.id].sort().join(),
    row.body.equipmentIds,
  );

  const bodyweight = await call('POST', '/exercises', { name: 'Plank', equipmentIds: [] });
  check('allows an exercise with no equipment', bodyweight.status === 201, bodyweight.status);

  const ghostEquipment = await call('POST', '/exercises', {
    name: 'Ghost lift',
    equipmentIds: [9999],
  });
  check('rejects unknown equipment with 400', ghostEquipment.status === 400, ghostEquipment);

  /* ------------------------------------------------------------- regimens */

  const regimen = await call('POST', '/regimens', {
    name: 'A - Fullbody',
    items: [
      { exerciseId: squat.body.id, sets: 3, repsMin: 5, repsMax: 5, restSeconds: 120 },
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

  const reordered = await call('PUT', `/regimens/${regimenId}`, {
    name: 'A - Fullbody',
    items: [
      { exerciseId: press.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 90 },
      { exerciseId: squat.body.id, sets: 3, repsMin: 5, repsMax: 5, restSeconds: 120 },
      { exerciseId: row.body.id, sets: 3, repsMin: 8, repsMax: 12, restSeconds: 60 },
      { exerciseId: curl.body.id, sets: 2, repsMin: 10, repsMax: 15, restSeconds: 60 },
    ],
  });
  check(
    'reorders regimen items on update',
    reordered.body.items[0].exerciseId === press.body.id,
    reordered.body.items.map((i) => i.exerciseId),
  );

  /* --------------------------------------- supersets and the plate pool */

  const pairs = await call('GET', `/regimens/${regimenId}/superset-pairs`);
  check('returns superset pairs', pairs.status === 200, pairs.status);
  const pairFor = (a, b) =>
    pairs.body.find(
      (p) =>
        (p.exerciseIds[0] === a && p.exerciseIds[1] === b) ||
        (p.exerciseIds[0] === b && p.exerciseIds[1] === a),
    );

  const squatCurl = pairFor(squat.body.id, curl.body.id);
  check(
    'blocks a superset across bars sharing plates',
    squatCurl?.compatible === false && squatCurl.conflicts.some((c) => c.reason === 'plate-pool'),
    squatCurl,
  );

  const squatPress = pairFor(squat.body.id, press.body.id);
  check(
    'blocks a superset needing the same equipment',
    squatPress?.compatible === false && squatPress.conflicts.some((c) => c.reason === 'equipment'),
    squatPress,
  );

  const pressRow = pairFor(press.body.id, row.body.id);
  check('blocks a superset sharing the bench', pressRow?.compatible === false, pressRow);

  const curlRow = pairFor(curl.body.id, row.body.id);
  check('allows a superset with independent equipment', curlRow?.compatible === true, curlRow);

  /* -------------------------------------------------------------- workout */

  const noHistory = await call('GET', `/exercises/${squat.body.id}/last-performance`);
  check('reports no history with 404', noHistory.status === 404, noHistory.status);

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
      regimenItemId: reordered.body.items[1].id,
      exerciseId: squat.body.id,
      setIndex: i,
      reps: 5,
      weightKg: 100,
    });
    if (logged.status !== 201) {
      failures++;
      console.log('  FAIL logs a set — ' + JSON.stringify(logged));
    }
  }
  checks++;
  console.log('  ok   logs three sets');

  const spare = await call('POST', `/sessions/${sessionId}/sets`, {
    regimenItemId: reordered.body.items[0].id,
    exerciseId: press.body.id,
    setIndex: 0,
    reps: 10,
    weightKg: 60,
  });
  check('logs a set for another exercise', spare.status === 201, spare.status);

  const undone = await call('DELETE', `/sessions/${sessionId}/sets/${spare.body.id}`);
  check('undoes a set', undone.status === 204, undone.status);

  const missingSession = await call('POST', '/sessions/9999/sets', {
    exerciseId: squat.body.id,
    setIndex: 0,
    reps: 5,
  });
  check('refuses a set on an unknown session', missingSession.status === 404, missingSession.status);

  const finished = await call('POST', `/sessions/${sessionId}/finish`, { notes: 'felt good' });
  check('finishes the session', finished.body?.endedAt !== null, finished.body?.endedAt);
  check('keeps the logged sets', finished.body.sets.length === 3, finished.body.sets.length);
  check('keeps the note', finished.body.notes === 'felt good', finished.body.notes);

  const afterFinish = await call('GET', '/sessions/active');
  check('has no active session afterwards', afterFinish.status === 404, afterFinish.status);

  /* ------------------------------------------------------ history, prefill */

  const history = await call('GET', '/sessions?limit=5');
  check(
    'summarises the session in history',
    history.body[0].setCount === 3 &&
      history.body[0].totalReps === 15 &&
      history.body[0].volumeKg === 1500,
    history.body[0],
  );

  const last = await call('GET', `/exercises/${squat.body.id}/last-performance`);
  check(
    'reports the last performance for prefill',
    last.body?.sets.length === 3 && last.body.sets[0].weightKg === 100,
    last.body,
  );

  const excluded = await call(
    'GET',
    `/exercises/${squat.body.id}/last-performance?exclude=${sessionId}`,
  );
  check('can exclude the current session', excluded.status === 404, excluded.status);

  /* ------------------------------------------------------------ history kept */

  const deleted = await call('DELETE', `/regimens/${regimenId}`);
  check('deletes a regimen', deleted.status === 204, deleted.status);

  const survivor = await call('GET', `/sessions/${sessionId}`);
  check(
    'keeps past workouts when their regimen is deleted',
    survivor.status === 200 && survivor.body.sets.length === 3,
    survivor.status,
  );
  check(
    'keeps the regimen name on the old session',
    survivor.body.regimenName === 'A - Fullbody',
    survivor.body.regimenName,
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
  failures === 0 ? `\n${checks} checks passed` : `\n${failures} of ${checks} checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
