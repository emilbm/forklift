import type { ReactNode } from 'react';
import { primeAudio } from '../audio';
import { formatClock } from '../format';
import type { Rest } from '../rest';
import { Sheet } from './ui';

const CHOICES = [60, 90, 120];

/** How far through the rest is, as a percentage. */
function progressOf(rest: Rest): number {
  if (rest.state === null || rest.state.duration <= 0) return 100;
  return Math.min(100, ((rest.state.duration - rest.remaining) / rest.state.duration) * 100);
}

interface RestTimerProps {
  rest: Rest;
  /** Anything to ask while resting — how the last exercise felt, usually. */
  children?: ReactNode;
}

/**
 * The rest sheet. It only draws the clock: the clock itself belongs to
 * `useRest`, so closing this carries on counting and still rings.
 */
export function RestTimer({ rest, children }: RestTimerProps) {
  const { done } = rest;
  if (rest.state === null) return null;

  return (
    <Sheet onClose={rest.hide}>
      <div className="rest">
        <p className="small muted" style={{ margin: 0 }}>
          Rest after {rest.state.after}
        </p>
        <div className={`rest__time num${done ? ' rest__time--done' : ''}`}>
          {done ? 'Go' : formatClock(rest.remaining)}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          {rest.state.next}
        </p>

        <div className="rest__bar">
          <div
            className={`rest__fill${done ? ' rest__fill--done' : ''}`}
            style={{ width: `${progressOf(rest)}%` }}
          />
        </div>

        {children}

        <div className="rest__choices">
          {CHOICES.map((seconds) => (
            <button
              key={seconds}
              className={`btn${rest.state?.duration === seconds && !done ? ' btn--primary' : ''}`}
              onClick={() => {
                // A tap is a gesture, and a gesture is what iOS wants before it
                // will let the bell ring later.
                primeAudio();
                rest.setDuration(seconds);
              }}
            >
              {seconds}s
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => rest.extend(30)} disabled={done}>
            +30s
          </button>
          <button className="btn btn--primary grow" onClick={rest.stop}>
            {done ? 'Next set' : 'Skip rest'}
          </button>
        </div>

        <button className="btn btn--ghost btn--block" style={{ marginTop: 8 }} onClick={rest.hide}>
          {done ? 'Close' : 'Hide — keep resting'}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The rest, shrunk to a strip along the bottom. Shown while the sheet is hidden
 * so the countdown is never out of sight, and tapping it brings the sheet back.
 */
export function RestBar({ rest }: { rest: Rest }) {
  if (rest.state === null) return null;

  return (
    <button
      className={`restbar${rest.done ? ' restbar--done' : ''}`}
      onClick={rest.show}
      aria-label="Show the rest timer"
    >
      <span className="restbar__fill" style={{ width: `${progressOf(rest)}%` }} />
      <span className="restbar__label">
        {rest.done ? 'Rest over — go' : 'Resting'}
        <span className="restbar__time num">{rest.done ? '' : formatClock(rest.remaining)}</span>
      </span>
      <span className="restbar__hint tiny">Tap to open</span>
    </button>
  );
}
