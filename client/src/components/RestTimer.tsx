import { useEffect, useMemo, useState } from 'react';
import { buzz, primeAudio, ringBell } from '../audio';
import { formatClock } from '../format';
import { Sheet } from './ui';

export interface RestState {
  /** Wall-clock time the rest ends, so a locked screen doesn't pause the count. */
  endsAt: number;
  duration: number;
}

const CHOICES = [60, 90, 120];

/** Bell and buzz when the rest is up — the phone is usually face down. */
function alertDone(): void {
  buzz();
  ringBell();
}

interface RestTimerProps {
  rest: RestState;
  exerciseName: string;
  nextLabel: string;
  onChange: (rest: RestState) => void;
  onDismiss: () => void;
}

export function RestTimer({
  rest,
  exerciseName,
  nextLabel,
  onChange,
  onDismiss,
}: RestTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [alerted, setAlerted] = useState(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 250);
    // Coming back from a locked screen should show the true remaining time at once.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const remaining = Math.max(0, (rest.endsAt - now) / 1000);
  const done = remaining <= 0;

  useEffect(() => {
    if (done && !alerted) {
      setAlerted(true);
      alertDone();
    }
  }, [done, alerted]);

  const progress = useMemo(
    () => (rest.duration <= 0 ? 100 : Math.min(100, ((rest.duration - remaining) / rest.duration) * 100)),
    [remaining, rest.duration],
  );

  const setDuration = (seconds: number) => {
    primeAudio();
    setAlerted(false);
    onChange({ endsAt: Date.now() + seconds * 1000, duration: seconds });
  };

  return (
    <Sheet onClose={onDismiss}>
      <div className="rest">
        <p className="small muted" style={{ margin: 0 }}>
          Rest after {exerciseName}
        </p>
        <div className={`rest__time num${done ? ' rest__time--done' : ''}`}>
          {done ? 'Go' : formatClock(remaining)}
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          {nextLabel}
        </p>

        <div className="rest__bar">
          <div
            className={`rest__fill${done ? ' rest__fill--done' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="rest__choices">
          {CHOICES.map((seconds) => (
            <button
              key={seconds}
              className={`btn${rest.duration === seconds && !done ? ' btn--primary' : ''}`}
              onClick={() => setDuration(seconds)}
            >
              {seconds}s
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn grow"
            onClick={() => onChange({ ...rest, endsAt: rest.endsAt + 30_000 })}
            disabled={done}
          >
            +30s
          </button>
          <button className="btn btn--primary grow" onClick={onDismiss}>
            {done ? 'Next set' : 'Skip rest'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
