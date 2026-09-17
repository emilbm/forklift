import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, ringBell } from './audio';

/**
 * The rest between sets.
 *
 * The clock deliberately lives here rather than inside the sheet that shows it:
 * a rest is part of the workout, not part of a dialog. Closing the sheet to
 * look at what is coming, or to change a weight, leaves the countdown running
 * and the bell armed — hiding the timer is not the same as ending it.
 */

export interface RestState {
  /** Wall-clock time the rest ends, so a locked screen doesn't pause the count. */
  endsAt: number;
  duration: number;
  /**
   * What the rest follows and what comes after it, as they were when it
   * started. Held here rather than read from the screen, which has already
   * moved on to the next exercise by the time the sheet appears.
   */
  after: string;
  next: string;
}

export interface RestContext {
  after: string;
  next: string;
}

export interface Rest {
  state: RestState | null;
  /** Seconds left, floored at zero. */
  remaining: number;
  done: boolean;
  /** Whether the full-screen sheet is showing. */
  open: boolean;
  start: (seconds: number, context: RestContext) => void;
  /** Restart the rest at a different length. */
  setDuration: (seconds: number) => void;
  extend: (seconds: number) => void;
  show: () => void;
  hide: () => void;
  /** End the rest outright — skipped, or moved on from. */
  stop: () => void;
}

export function useRest(): Rest {
  const [state, setState] = useState<RestState | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** The rest whose bell has already rung, so it rings once and only once. */
  const rung = useRef<number | null>(null);

  const endsAt = state?.endsAt ?? null;

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(() => {
      tick();
      // Nothing changes once it has rung; stop re-rendering four times a second.
      if (Date.now() > endsAt + 1000) window.clearInterval(id);
    }, 250);
    // Coming back from a locked screen should show the true remaining time at once.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [endsAt]);

  const remaining = endsAt === null ? 0 : Math.max(0, (endsAt - now) / 1000);
  const done = endsAt !== null && remaining <= 0;

  useEffect(() => {
    if (endsAt === null || !done || rung.current === endsAt) return;
    rung.current = endsAt;
    buzz();
    ringBell();
  }, [endsAt, done]);

  const start = useCallback((seconds: number, context: RestContext) => {
    setState({ endsAt: Date.now() + seconds * 1000, duration: seconds, ...context });
    setOpen(true);
  }, []);

  const setDuration = useCallback((seconds: number) => {
    setState((prev) =>
      prev === null
        ? prev
        : { ...prev, endsAt: Date.now() + seconds * 1000, duration: seconds },
    );
  }, []);

  const extend = useCallback((seconds: number) => {
    setState((prev) =>
      prev === null
        ? prev
        : { ...prev, endsAt: prev.endsAt + seconds * 1000, duration: prev.duration + seconds },
    );
  }, []);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const stop = useCallback(() => {
    setState(null);
    setOpen(false);
  }, []);

  return { state, remaining, done, open, start, setDuration, extend, show, hide, stop };
}
