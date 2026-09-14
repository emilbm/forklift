import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RegimenItem, SetLog } from '../../../shared/types';
import { api } from '../api';
import { RestTimer, type RestState } from '../components/RestTimer';
import { ErrorBanner, IconCheck, IconClose, Sheet, Spinner } from '../components/ui';
import { formatDuration, formatReps, formatWeight } from '../format';
import {
  invalidateSessions,
  useExercises,
  useLastPerformance,
  useRegimen,
  useSession,
} from '../queries';
import { useWakeLock } from '../useWakeLock';

const WEIGHT_STEP = 2.5;

export default function WorkoutPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const session = useSession(Number.isFinite(sessionId) ? sessionId : null);
  const regimen = useRegimen(session.data?.regimenId ?? null);
  const exercises = useExercises();

  const [index, setIndex] = useState(0);
  const [followProgress, setFollowProgress] = useState(true);
  const [rest, setRest] = useState<RestState | null>(null);
  const [weights, setWeights] = useState<Record<number, number | null>>({});
  const [error, setError] = useState<unknown>(null);
  const [logging, setLogging] = useState(false);
  const [finishing, setFinishing] = useState(false);

  useWakeLock(session.data?.endedAt === null);

  const exerciseName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  const items = regimen.data?.items ?? [];

  /** Sets already logged for each regimen item, in the order they were done. */
  const setsByItem = useMemo(() => {
    const map = new Map<number, SetLog[]>();
    for (const log of session.data?.sets ?? []) {
      if (log.regimenItemId === null) continue;
      const list = map.get(log.regimenItemId) ?? [];
      list.push(log);
      map.set(log.regimenItemId, list);
    }
    return map;
  }, [session.data?.sets]);

  const firstUnfinished = useMemo(() => {
    const at = items.findIndex((item) => (setsByItem.get(item.id)?.length ?? 0) < item.sets);
    return at === -1 ? Math.max(0, items.length - 1) : at;
  }, [items, setsByItem]);

  // Follow progress automatically until the lifter picks an exercise by hand.
  useEffect(() => {
    if (followProgress) setIndex(firstUnfinished);
  }, [firstUnfinished, followProgress]);

  const item = items[Math.min(index, Math.max(0, items.length - 1))];
  const done = setsByItem.get(item?.id ?? -1) ?? [];
  const allDone = items.length > 0 && items.every((i) => (setsByItem.get(i.id)?.length ?? 0) >= i.sets);

  const lastTime = useLastPerformance(item?.exerciseId ?? null, sessionId);

  /**
   * Weight to show: what was used earlier in this session, else last time's
   * working weight, else blank so nothing is silently invented.
   */
  const suggestedWeight = useMemo(() => {
    if (!item) return null;
    const inSession = done.at(-1)?.weightKg;
    if (inSession !== undefined && inSession !== null) return inSession;
    const previous = lastTime.data?.sets.at(-1)?.weightKg;
    return previous ?? null;
  }, [item, done, lastTime.data]);

  const weight = item && item.id in weights ? weights[item.id]! : suggestedWeight;

  if (session.isLoading || (session.data?.regimenId !== null && regimen.isLoading)) {
    return (
      <>
        <header className="header">
          <h1>Workout</h1>
        </header>
        <main className="main main--nonav">
          <Spinner />
        </main>
      </>
    );
  }

  if (session.error || !session.data) {
    return (
      <>
        <header className="header">
          <h1>Workout</h1>
        </header>
        <main className="main main--nonav">
          <ErrorBanner error={session.error ?? new Error('Session not found')} />
          <button className="btn btn--block" onClick={() => navigate('/')} style={{ marginTop: 12 }}>
            Back home
          </button>
        </main>
      </>
    );
  }

  if (session.data.endedAt !== null) {
    return <FinishedSummary sessionId={sessionId} />;
  }

  async function logSet(reps: number) {
    if (!item || logging) return;
    setLogging(true);
    setError(null);
    try {
      await api.sessions.logSet(sessionId, {
        regimenItemId: item.id,
        exerciseId: item.exerciseId,
        setIndex: done.length,
        reps,
        weightKg: weight,
      });
      invalidateSessions(qc, sessionId);
      // Last set of the exercise needs no rest prompt — the next lift is a change of station.
      const wasLast = done.length + 1 >= item.sets;
      if (!wasLast) {
        setRest({ endsAt: Date.now() + item.restSeconds * 1000, duration: item.restSeconds });
      }
    } catch (err) {
      setError(err);
    } finally {
      setLogging(false);
    }
  }

  async function undoSet(log: SetLog) {
    setError(null);
    try {
      await api.sessions.removeSet(sessionId, log.id);
      invalidateSessions(qc, sessionId);
    } catch (err) {
      setError(err);
    }
  }

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      await api.sessions.finish(sessionId);
      invalidateSessions(qc, sessionId);
    } catch (err) {
      setError(err);
      setFinishing(false);
    }
  }

  const setWeight = (next: number | null) =>
    item && setWeights((prev) => ({ ...prev, [item.id]: next }));

  const nextLabel = item
    ? done.length + 1 >= item.sets
      ? 'Last set done — next exercise up'
      : `Next: set ${done.length + 1} of ${item.sets}`
    : '';

  return (
    <>
      <header className="header">
        <button
          className="btn btn--icon btn--quiet"
          onClick={() => navigate('/')}
          aria-label="Leave workout"
        >
          <IconClose />
        </button>
        <h1>
          {session.data.regimenName}
          <span className="sub"> · {formatDuration(session.data.startedAt, null)}</span>
        </h1>
        <button className="btn btn--sm btn--primary" onClick={finish} disabled={finishing}>
          Finish
        </button>
      </header>

      <main className="main main--nonav">
        <ErrorBanner error={error} />

        <div className="exnav">
          {items.map((entry, i) => {
            const logged = setsByItem.get(entry.id)?.length ?? 0;
            const complete = logged >= entry.sets;
            return (
              <button
                key={entry.id}
                className={`exnav__item${i === index ? ' exnav__item--current' : ''}${
                  complete ? ' exnav__item--done' : ''
                }`}
                onClick={() => {
                  setFollowProgress(false);
                  setIndex(i);
                }}
              >
                {complete && <IconCheck size={13} />} {exerciseName.get(entry.exerciseId) ?? '?'}{' '}
                <span className="num faint">
                  {logged}/{entry.sets}
                </span>
              </button>
            );
          })}
        </div>

        {!item ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              This regimen has no exercises. Add some, or finish the session.
            </p>
          </div>
        ) : (
          <>
            <div className="card card--accent">
              <div className="row row--between">
                <div className="grow">
                  <h2 style={{ fontSize: '1.25rem' }}>
                    {exerciseName.get(item.exerciseId) ?? 'Unknown exercise'}
                  </h2>
                  <div className="wk-target num" style={{ marginTop: 4 }}>
                    {done.length}
                    <small>of {item.sets} sets</small>
                    <span className="faint" style={{ fontSize: '1.1rem' }}>
                      ·
                    </span>
                    <small>{formatReps(item)} reps</small>
                  </div>
                </div>
              </div>

              {lastTime.data && (
                <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                  Last time:{' '}
                  {lastTime.data.sets
                    .map((s) => `${s.reps}×${formatWeight(s.weightKg)}`)
                    .join(', ')}{' '}
                  kg
                </p>
              )}

              <div className="setdots" style={{ marginTop: 12 }}>
                {Array.from({ length: Math.max(item.sets, done.length) }, (_, i) => {
                  const log = done[i];
                  return log ? (
                    <button
                      key={log.id}
                      className="setdot setdot--done"
                      onClick={() => undoSet(log)}
                      title="Tap to undo this set"
                    >
                      {log.reps} × {formatWeight(log.weightKg)}
                    </button>
                  ) : (
                    <span key={`todo-${i}`} className="setdot">
                      set {i + 1}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="field">
                <label htmlFor="weight">Weight</label>
                <div className="weight">
                  <button
                    className="btn btn--icon"
                    onClick={() => setWeight(Math.max(0, (weight ?? 0) - WEIGHT_STEP))}
                    aria-label={`Less ${WEIGHT_STEP} kg`}
                  >
                    −
                  </button>
                  <div>
                    <input
                      id="weight"
                      className="weight__value num"
                      type="number"
                      inputMode="decimal"
                      step={WEIGHT_STEP}
                      min={0}
                      placeholder="—"
                      value={weight ?? ''}
                      onChange={(e) =>
                        setWeight(e.target.value === '' ? null : Number(e.target.value))
                      }
                    />
                    <div className="weight__unit" style={{ textAlign: 'center' }}>
                      kg
                    </div>
                  </div>
                  <button
                    className="btn btn--icon"
                    onClick={() => setWeight((weight ?? 0) + WEIGHT_STEP)}
                    aria-label={`More ${WEIGHT_STEP} kg`}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="field">
                <label>Tap the reps you did</label>
                <RepPad item={item} disabled={logging} onPick={logSet} />
              </div>
            </div>
          </>
        )}

        {allDone && (
          <button
            className="btn btn--primary btn--block btn--lg"
            onClick={finish}
            disabled={finishing}
            style={{ marginTop: 14 }}
          >
            <IconCheck /> Every set done — finish workout
          </button>
        )}
      </main>

      {rest && item && (
        <RestTimer
          rest={rest}
          exerciseName={exerciseName.get(item.exerciseId) ?? 'that'}
          nextLabel={nextLabel}
          onChange={setRest}
          onDismiss={() => setRest(null)}
        />
      )}
    </>
  );
}

/** Rep buttons spanning the target range, with room either side for a good or bad day. */
function RepPad({
  item,
  disabled,
  onPick,
}: {
  item: RegimenItem;
  disabled: boolean;
  onPick: (reps: number) => void;
}) {
  const low = Math.max(1, item.repsMin - 2);
  const high = Math.min(low + 14, item.repsMax + 3);
  const values = Array.from({ length: high - low + 1 }, (_, i) => low + i);

  return (
    <>
      <div className="reppad">
        {values.map((reps) => {
          const onTarget = reps >= item.repsMin && reps <= item.repsMax;
          return (
            <button
              key={reps}
              className={`reppad__btn num${onTarget ? ' reppad__btn--target' : ''}`}
              disabled={disabled}
              onClick={() => onPick(reps)}
            >
              {reps}
            </button>
          );
        })}
      </div>
      <p className="tiny faint" style={{ margin: '8px 0 0' }}>
        Highlighted buttons are inside the {formatReps(item)} rep target.
      </p>
    </>
  );
}

/* --------------------------------------------------------------- summary */

function FinishedSummary({ sessionId }: { sessionId: number }) {
  const session = useSession(sessionId);
  const exercises = useExercises();
  const navigate = useNavigate();

  const name = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  if (!session.data) return <Spinner />;

  const byExercise = new Map<number, SetLog[]>();
  for (const log of session.data.sets) {
    const list = byExercise.get(log.exerciseId) ?? [];
    list.push(log);
    byExercise.set(log.exerciseId, list);
  }

  const volume = session.data.sets.reduce(
    (total, log) => total + log.reps * (log.weightKg ?? 0),
    0,
  );

  return (
    <Sheet title="Workout done" onClose={() => navigate('/')}>
      <div className="stack">
        <div className="row row--wrap" style={{ gap: 8 }}>
          <span className="chip chip--accent">
            {formatDuration(session.data.startedAt, session.data.endedAt)}
          </span>
          <span className="chip">{session.data.sets.length} sets</span>
          <span className="chip">{formatWeight(volume)} kg total volume</span>
        </div>

        {[...byExercise.entries()].map(([exerciseId, logs]) => (
          <div key={exerciseId} className="card">
            <strong>{name.get(exerciseId) ?? 'Exercise'}</strong>
            <p className="small muted num" style={{ margin: '4px 0 0' }}>
              {logs.map((log) => `${log.reps} × ${formatWeight(log.weightKg)}`).join('  ·  ')} kg
            </p>
          </div>
        ))}

        {session.data.sets.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            No sets were logged in this session.
          </p>
        )}

        <button className="btn btn--primary btn--block btn--lg" onClick={() => navigate('/')}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
