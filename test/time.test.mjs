/**
 * "How long ago" wording. Run via `npm test`, which builds shared/ first.
 */
import { formatAgo } from '../server/dist/shared/time.js';

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

// A fixed "now" so the boundaries are not a moving target.
const now = new Date(2026, 8, 15, 10, 0, 0); // 15 September 2026, 10:00 local
const daysAgo = (days, hour = 10) =>
  new Date(2026, 8, 15 - days, hour, 0, 0).toISOString();

const says = (days, hour) => formatAgo(daysAgo(days, hour), now);

check('this morning is today', says(0) === 'today', says(0));
check('late last night is yesterday', says(1, 23) === 'yesterday', says(1, 23));
check('two days is counted in days', says(2) === '2 days ago', says(2));
check('a week is still counted in days', says(7) === '7 days ago', says(7));
check('thirteen days is the last day-count', says(13) === '13 days ago', says(13));
check('fourteen days becomes weeks', says(14) === '2 weeks ago', says(14));
check('a month and a bit is weeks', says(35) === '5 weeks ago', says(35));
check('two months is counted in months', says(61) === '2 months ago', says(61));
check('half a year', says(182) === '6 months ago', says(182));
check('a year is a year', says(365) === '1 year ago', says(365));
check('two years', says(730) === '2 years ago', says(730));

check('singular day reads naturally', says(1) === 'yesterday', says(1));
check(
  'singular week reads naturally',
  formatAgo(daysAgo(14), new Date(2026, 8, 15, 10)) === '2 weeks ago',
  says(14),
);

// Counted by calendar day, not by elapsed hours.
check(
  'an evening set reads as yesterday the next morning',
  formatAgo(new Date(2026, 8, 14, 21, 0).toISOString(), new Date(2026, 8, 15, 8, 0)) ===
    'yesterday',
);
check(
  'eleven hours within the same day is still today',
  formatAgo(new Date(2026, 8, 15, 7, 0).toISOString(), new Date(2026, 8, 15, 18, 0)) === 'today',
);

// Defensive: a clock out of step, or nonsense in the database.
check('a future date does not read as negative', formatAgo(daysAgo(-3), now) === 'today', formatAgo(daysAgo(-3), now));
check('an unparseable date yields nothing', formatAgo('not a date') === '');

console.log(
  failures === 0 ? `\n${checks} time checks passed` : `\n${failures} of ${checks} time checks FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
