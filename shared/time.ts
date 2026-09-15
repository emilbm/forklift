/**
 * How long ago something happened, in the words you'd use out loud.
 *
 * Counted in calendar days rather than elapsed hours: a set logged at 9pm
 * yesterday reads as "yesterday" this morning, not "11 hours ago". Kept in
 * English deliberately — the rest of the interface is English, and
 * `Intl.RelativeTimeFormat` would follow the phone's locale and mix the two.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days between two instants, by local midnight. */
function calendarDaysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toMidnight.getTime() - fromMidnight.getTime()) / DAY_MS);
}

const plural = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? '' : 's'} ago`;

export function formatAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const days = calendarDaysBetween(then, now);

  // A clock a little out of step shouldn't produce "-1 days ago".
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return plural(days, 'day');
  if (days < 60) return plural(Math.round(days / 7), 'week');
  if (days < 365) return plural(Math.round(days / 30.44), 'month');
  return plural(Math.round(days / 365.25), 'year');
}
