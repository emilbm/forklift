/**
 * The two pure pieces of the error reporter: reading a DSN, and turning a
 * stack string into frames. Everything else in sentry.ts talks to the network,
 * and is covered end to end by the API test against a fake GlitchTip.
 *
 * Run via `npm test`, which builds the server first.
 */
import { parseDsn, parseStack } from '../server/dist/server/src/sentry.js';

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

function rejects(label, dsn, expected) {
  checks++;
  try {
    parseDsn(dsn);
    failures++;
    console.log('  FAIL ' + label + ' — accepted ' + JSON.stringify(dsn));
  } catch (err) {
    if (expected.test(err.message)) {
      console.log('  ok   ' + label);
    } else {
      failures++;
      console.log('  FAIL ' + label + ' — wrong complaint: ' + err.message);
    }
  }
}

/* ----------------------------------------------------------------- the DSN */

const plain = parseDsn('https://abc123@glitch.bech.lol/5');
check(
  'turns a DSN into the envelope endpoint',
  plain.url === 'https://glitch.bech.lol/api/5/envelope/',
  plain.url,
);
check('and keeps the public key for the auth header', plain.publicKey === 'abc123', plain.publicKey);
check('and the project id', plain.projectId === '5', plain.projectId);

// Self-hosted GlitchTip behind a subpath: everything before the last segment
// is prefix, not project.
const nested = parseDsn('https://k@example.test/glitch/sub/12');
check(
  'keeps a path prefix in front of the API path',
  nested.url === 'https://example.test/glitch/sub/api/12/envelope/',
  nested.url,
);
check('and still finds the project id at the end', nested.projectId === '12', nested.projectId);

// Reaching GlitchTip over the Docker network, where there is no certificate
// to trust, is plain http and entirely legitimate.
const insecure = parseDsn('http://k@glitchtip-web:8000/3');
check(
  'allows plain http, for a container on the same network',
  insecure.url === 'http://glitchtip-web:8000/api/3/envelope/',
  insecure.url,
);

const ported = parseDsn('https://k@glitch.bech.lol:8443/9');
check(
  'keeps a non-standard port',
  ported.url === 'https://glitch.bech.lol:8443/api/9/envelope/',
  ported.url,
);

rejects('refuses something that is not a URL', 'not-a-dsn', /not a valid URL/);
rejects('refuses a protocol it cannot post to', 'ftp://k@example.test/1', /http or https/);
rejects('refuses a DSN with no public key', 'https://example.test/1', /public key/);
rejects('refuses a DSN with no project id', 'https://k@example.test', /project id/);
rejects('refuses a DSN whose path is only slashes', 'https://k@example.test///', /project id/);

/* --------------------------------------------------------------- the stack */

const nodeStack = [
  'Error: boom',
  '    at logSet (file:///app/server/dist/server/src/routes.js:120:11)',
  '    at handler (/app/node_modules/fastify/lib/handle.js:10:5)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
].join('\n');

const frames = parseStack(nodeStack);
check('reads every frame of a V8 stack', frames.length === 3, frames.length);
check(
  'puts the throwing frame last, which is where Sentry shows it',
  frames.at(-1)?.function === 'logSet',
  frames.at(-1),
);
check(
  'strips the file:// off an ESM path',
  frames.at(-1)?.filename === '/app/server/dist/server/src/routes.js',
  frames.at(-1)?.filename,
);
check('keeps the line and column', frames.at(-1)?.lineno === 120 && frames.at(-1)?.colno === 11, frames.at(-1));
check('marks our own code as in_app', frames.at(-1)?.in_app === true, frames.at(-1));
check(
  'and a dependency as not',
  frames.find((f) => f.filename.includes('node_modules'))?.in_app === false,
  frames.find((f) => f.filename.includes('node_modules')),
);
check(
  "and node's own internals as not",
  frames.find((f) => f.filename.startsWith('node:'))?.in_app === false,
  frames.find((f) => f.filename.startsWith('node:')),
);

// Browser stacks arrive forwarded from the client and carry page URLs.
const browserFrames = parseStack(
  'TypeError: x is undefined\n    at render (https://forklift.bech.lol/assets/index-abc.js:3:4012)',
);
check(
  'treats a forwarded browser frame as in_app',
  browserFrames[0]?.in_app === true && browserFrames[0]?.function === 'render',
  browserFrames[0],
);

const anonymous = parseStack('Error: x\n    at /app/server/dist/server/src/index.js:9:1');
check(
  'names a frame with no function',
  anonymous[0]?.function === '<anonymous>',
  anonymous[0],
);

check('shrugs at a stack that is not a string', parseStack(undefined).length === 0);
check('and at one with nothing it recognises', parseStack('no frames here').length === 0);

console.log(
  failures === 0
    ? `\n${checks} reporter checks passed`
    : `\n${failures} of ${checks} reporter checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
