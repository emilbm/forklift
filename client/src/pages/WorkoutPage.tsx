import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Effort, Equipment, RegimenItem, SetLog } from '../../../shared/types';
import { currentStepIndex, planWorkout, type WorkoutStep } from '../../../shared/plan';
import { nextWeightDown, nextWeightUp, suggestWeight } from '../../../shared/progress';
import { formatAgo } from '../../../shared/time';
import { api } from '../api';
import { primeAudio } from '../audio';
import { RestBar, RestTimer } from '../components/RestTimer';
import {
  DecimalInput,
  ErrorBanner,
  IconCheck,
  IconClose,
  Sheet,
  Spinner,
} from '../components/ui';
import { formatDuration, formatReps, formatWeight } from '../format';
import {
  invalidateSessions,
  useEquipment,
  useEquipmentLoads,
  useExercises,
  useLastPerformance,
  useLoadPlan,
  useRegimen,
  useSession,
} from '../queries';
import { useRest } from '../rest';
import { useWakeLock } from '../useWakeLock';

/** Used when nothing better is known — no bar, or no plates recorded yet. */
const FALLBACK_STEP = 2.5;

export default function WorkoutPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const session = useSession(Number.isFinite(sessionId) ? sessionId : null);
  const regimen = useRegimen(session.data?.regimenId ?? null);
  const exercises = useExercises();
  const equipment = useEquipment();

  const [index, setIndex] = useState(0);
  const [followProgress, setFollowProgress] = useState(true);
  const rest = useRest();
  const [weights, setWeights] = useState<Record<number, number | null>>({});
  /** The exercise whose last set was just logged, waiting to be rated. */
  const [rating, setRating] = useState<RegimenItem | null>(null);
  /** Ratings answered but not yet confirmed by a refetch. */
  const [pendingEfforts, setPendingEfforts] = useState<Record<number, Effort>>({});
  const [error, setError] = useState<unknown>(null);
  const [logging, setLogging] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [skipping, setSkipping] = useState<RegimenItem | null>(null);

  useWakeLock(session.data?.endedAt === null);

  const exerciseName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  const items = useMemo(() => regimen.data?.items ?? [], [regimen.data]);

  /**
   * The order the sets are actually done in. A supersetted pair alternates —
   * A1, B1, A2, B2 — so progress is tracked by step, not by exercise.
   */
  const skippedItemIds = useMemo(
    () => new Set((session.data?.skips ?? []).map((skip) => skip.regimenItemId)),
    [session.data?.skips],
  );

  const steps = useMemo(
    () => planWorkout(items, { skippedItemIds }),
    [items, skippedItemIds],
  );

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

  const completedByItem = useMemo(
    () => new Map([...setsByItem].map(([id, logs]) => [id, logs.length])),
    [setsByItem],
  );

  const outstanding = useMemo(
    () => currentStepIndex(steps, completedByItem),
    [steps, completedByItem],
  );

  // Follow progress automatically until the lifter picks an exercise by hand.
  useEffect(() => {
    if (followProgress && outstanding >= 0) setIndex(outstanding);
  }, [outstanding, followProgress]);

  const step = steps[Math.min(index, Math.max(0, steps.length - 1))];
  const item = step?.item;
  const done = setsByItem.get(item?.id ?? -1) ?? [];
  const allDone = steps.length > 0 && outstanding === -1;

  const upNext = steps[index + 1];

  /**
   * The next step of the same round — the exercise to walk straight over to.
   * Absent on the last step of a round, which is where the rest belongs.
   */
  const sameRoundNext =
    step && upNext && upNext.group === step.group && upNext.round === step.round ? upNext : null;

  /**
   * The steps of this round. A pair with uneven set counts stops being a pair
   * once the shorter exercise runs out, so the round — not the group — is what
   * decides whether there is still someone to alternate with.
   */
  const roundSteps = useMemo(
    () =>
      step === undefined
        ? []
        : steps.filter((other) => other.group === step.group && other.round === step.round),
    [steps, step],
  );

  /** The same pair coming round again after the rest, if it does. */
  const nextRoundFirst = upNext && step && upNext.group === step.group ? upNext : null;

  const lastTime = useLastPerformance(item?.exerciseId ?? null, sessionId);

  /** How each exercise of this session was rated — the answer shows at once. */
  const effortFor = (exerciseId: number): Effort | null =>
    pendingEfforts[exerciseId] ??
    (session.data?.efforts ?? []).find((e) => e.exerciseId === exerciseId)?.effort ??
    null;

  /**
   * What decides the weights on offer: a plate-loaded bar, or a rack or stack
   * with a fixed ladder. Either way the stepper moves between real weights.
   */
  const weightSource = useMemo((): Equipment | null => {
    if (!item) return null;
    const exercise = (exercises.data ?? []).find((e) => e.id === item.exerciseId);
    if (!exercise) return null;
    const byId = new Map((equipment.data ?? []).map((e) => [e.id, e]));
    const candidates = exercise.equipmentIds
      .map((id) => byId.get(id))
      .filter((e): e is Equipment => e !== undefined);
    return (
      candidates.find((e) => e.usesPlates) ?? candidates.find((e) => e.incrementKg > 0) ?? null
    );
  }, [item, exercises.data, equipment.data]);

  const bar = weightSource?.usesPlates ? weightSource : null;
  const loadable = useEquipmentLoads(weightSource?.id ?? null);
  const achievable = loadable.data?.weights ?? [];

  /**
   * The weights this equipment can actually be set to. Null while a bar's
   * plates are still loading, so a suggestion waits rather than guessing at an
   * increment; empty when the weight is simply typed in, which steps freely.
   */
  const ladder = useMemo(
    () => (weightSource === null ? [] : loadable.data ? loadable.data.weights : null),
    [weightSource, loadable.data],
  );

  /**
   * Weight to show: what was used earlier in this session, else last time's
   * working weight — one increment heavier if last time felt easy.
   */
  const suggestion = useMemo(() => {
    if (!item) return { value: null, upFrom: null };
    // The most recent weight that was actually recorded — a set logged without
    // one shouldn't wipe out the suggestion.
    const lastRecorded = (sets: Array<{ weightKg: number | null }>): number | null => {
      for (let i = sets.length - 1; i >= 0; i--) {
        const weightKg = sets[i]?.weightKg;
        if (weightKg !== null && weightKg !== undefined) return weightKg;
      }
      return null;
    };

    const inSession = lastRecorded(done);
    if (inSession !== null) return { value: inSession, upFrom: null };

    const lastWeightKg = lastRecorded(lastTime.data?.sets ?? []);
    const value = suggestWeight({
      lastWeightKg,
      effort: lastTime.data?.effort ?? null,
      ladder,
      fallbackStepKg: FALLBACK_STEP,
    });
    const upFrom =
      value !== null && lastWeightKg !== null && value > lastWeightKg ? lastWeightKg : null;
    return { value, upFrom };
  }, [item, done, lastTime.data, ladder]);

  const weight = item && item.id in weights ? weights[item.id]! : suggestion.value;

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
    // iOS only lets audio start from a gesture; this is the gesture that
    // precedes every rest, so it is where the bell gets its permission.
    primeAudio();
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

      // The last set of an exercise earns a verdict: easy, ok or hard. It is
      // asked here, while the exercise is still what you were just doing.
      setRating(done.length + 1 >= item.sets ? item : null);

      // Move on straight away rather than waiting for the refetch to say so —
      // in a superset the jump to the partner is the whole interaction, and a
      // round trip of hesitation reads as the link not working.
      //
      // Stay inside the current group until it is finished: the steps of a
      // group are contiguous, so the next one is simply index + 1. Only once
      // the group runs out does the plan take over again — otherwise jumping
      // ahead to a superset would bounce you back to the first unfinished
      // exercise after a single set, mid-pair.
      const next = steps[index + 1];
      if (step && next && next.group === step.group) {
        setFollowProgress(false);
        setIndex(index + 1);
      } else {
        setFollowProgress(true);
      }

      // The plan decides the rest: none between the halves of a superset, none
      // after the final round, otherwise the length the regimen prescribes.
      const seconds = step?.restSeconds ?? 0;
      if (seconds > 0) {
        rest.start(seconds, {
          after: exerciseName.get(item.exerciseId) ?? 'that',
          next: describeStep(next, exerciseName),
        });
      } else {
        // Straight on to the partner — any rest still on screen is over.
        rest.stop();
      }
    } catch (err) {
      setError(err);
    } finally {
      setLogging(false);
    }
  }

  async function rateEffort(target: RegimenItem, effort: Effort) {
    setError(null);
    // Show the answer at once; the refetch confirms it a moment later.
    setPendingEfforts((prev) => ({ ...prev, [target.exerciseId]: effort }));
    try {
      await api.sessions.rateEffort(sessionId, target.exerciseId, target.id, effort);
      invalidateSessions(qc, sessionId);
    } catch (err) {
      // Take the answer back off the screen rather than showing one that isn't saved.
      setPendingEfforts((prev) => {
        const next = { ...prev };
        delete next[target.exerciseId];
        return next;
      });
      setError(err);
    }
  }

  async function skipExercise(target: RegimenItem, reason: string) {
    setError(null);
    try {
      await api.sessions.skip(sessionId, target.id, target.exerciseId, reason);
      invalidateSessions(qc, sessionId);
      setSkipping(null);
    } catch (err) {
      setError(err);
    }
  }

  async function unskipExercise(regimenItemId: number) {
    setError(null);
    try {
      await api.sessions.unskip(sessionId, regimenItemId);
      invalidateSessions(qc, sessionId);
    } catch (err) {
      setError(err);
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

  /** The collapsed rest strip takes room at the bottom of the page. */
  const restBarShowing = rest.state !== null && !rest.open;

  /**
   * Step to the next weight the plates can actually make, rather than a fixed
   * 2.5 kg that might land on something unloadable.
   */
  const stepWeight = (direction: 1 | -1) => {
    const current = weight ?? weightSource?.barWeightKg ?? 0;
    setWeight(
      direction === 1
        ? nextWeightUp(current, achievable, FALLBACK_STEP)
        : nextWeightDown(current, achievable, FALLBACK_STEP),
    );
  };

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

      <main className={`main main--nonav${restBarShowing ? ' main--restbar' : ''}`}>
        <ErrorBanner error={error} />

        <div className="exnav">
          {items.map((entry) => {
            const logged = setsByItem.get(entry.id)?.length ?? 0;
            const complete = logged >= entry.sets;
            const isSkipped = skippedItemIds.has(entry.id);
            const linked = steps.some(
              (other) => other.group.includes(entry) && other.group.length > 1,
            );
            return (
              <button
                key={entry.id}
                className={`exnav__item${entry.id === item?.id ? ' exnav__item--current' : ''}${
                  complete ? ' exnav__item--done' : ''
                }${linked ? ' exnav__item--linked' : ''}${
                  isSkipped ? ' exnav__item--skipped' : ''
                }`}
                onClick={() => {
                  if (isSkipped) {
                    void unskipExercise(entry.id);
                    return;
                  }
                  setFollowProgress(false);
                  // Jump to this exercise's next outstanding set, not to set one.
                  const target = steps.findIndex(
                    (candidate) =>
                      candidate.item.id === entry.id && candidate.setIndex >= Math.min(logged, entry.sets - 1),
                  );
                  if (target >= 0) setIndex(target);
                }}
              >
                {complete && !isSkipped && <IconCheck size={13} />}
                {linked && '⇄ '}
                {exerciseName.get(entry.exerciseId) ?? '?'}{' '}
                <span className="num faint">
                  {isSkipped ? 'skipped' : `${logged}/${entry.sets}`}
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
                    {/* Sets actually logged. Keeps telling the truth if you work
                        past the prescription, which the plan no longer tracks. */}
                    <span>{done.length}</span>
                    <small>of {item.sets} sets</small>
                    <span className="faint" style={{ fontSize: '1.1rem' }}>
                      ·
                    </span>
                    <small>{formatReps(item)} reps</small>
                  </div>
                </div>
              </div>

              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn--sm btn--ghost" onClick={() => setSkipping(item)}>
                  Skip this exercise
                </button>
              </div>

              {step && roundSteps.length > 1 && (
                <div className="superset-note">
                  <span>
                    ⇄ Superset — {roundSteps.indexOf(step) + 1} of {roundSteps.length}
                  </span>
                  <span className="superset-note__next">
                    {sameRoundNext
                      ? `No rest — straight on to ${
                          exerciseName.get(sameRoundNext.item.exerciseId) ?? 'the next lift'
                        }`
                      : nextRoundFirst
                        ? `Rest after this, then back to ${
                            exerciseName.get(nextRoundFirst.item.exerciseId) ?? 'the first lift'
                          }`
                        : 'Rest after this — last round of the pair'}
                  </span>
                </div>
              )}

              {lastTime.data && (
                <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                  Last time
                  {lastTime.data.performedAt && (
                    <span className="lasttime__when"> {formatAgo(lastTime.data.performedAt)}</span>
                  )}
                  :{' '}
                  {lastTime.data.sets.some((s) => s.weightKg !== null)
                    ? `${lastTime.data.sets
                        .map((s) => `${s.reps}×${formatWeight(s.weightKg)}`)
                        .join(', ')} kg`
                    : // No weight was recorded, so don't print "8×— kg".
                      `${lastTime.data.sets.map((s) => `${s.reps}`).join(', ')} reps`}
                  {lastTime.data.effort && ` — felt ${lastTime.data.effort}`}
                  {suggestion.upFrom !== null && (
                    <span className="lasttime__up">
                      , so {formatWeight(suggestion.upFrom)} → {formatWeight(suggestion.value)}{' '}
                      kg today
                    </span>
                  )}
                </p>
              )}

              {done.length >= item.sets && (
                <EffortPicker
                  name={exerciseName.get(item.exerciseId) ?? 'that'}
                  value={effortFor(item.exerciseId)}
                  onPick={(effort) => rateEffort(item, effort)}
                />
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
                    onClick={() => stepWeight(-1)}
                    aria-label="Lighter"
                  >
                    −
                  </button>
                  <div>
                    <DecimalInput
                      id="weight"
                      className="weight__value num"
                      min={0}
                      placeholder="—"
                      value={weight}
                      onChange={setWeight}
                    />
                    <div className="weight__unit" style={{ textAlign: 'center' }}>
                      kg
                    </div>
                  </div>
                  <button
                    className="btn btn--icon"
                    onClick={() => stepWeight(1)}
                    aria-label="Heavier"
                  >
                    +
                  </button>
                </div>
              </div>
              {bar ? (
                <PlateBreakdown bar={bar} targetKg={weight} />
              ) : (
                weightSource?.incrementKg ? (
                  <p className="tiny faint" style={{ margin: '10px 0 0' }}>
                    {weightSource.kind === 'dumbbell' ? 'Per dumbbell. ' : ''}
                    {formatWeight(weightSource.minWeightKg)}–{formatWeight(weightSource.maxWeightKg)} kg
                    in {formatWeight(weightSource.incrementKg)} kg steps.
                  </p>
                ) : null
              )}
            </div>

            <div className="card">
              <div className="field">
                <label>Tap the reps you did</label>
                <RepPad item={item} disabled={logging} onPick={logSet} />
              </div>
            </div>
          </>
        )}

        {session.data.skips.length > 0 && (
          <div className="card" style={{ marginTop: 12 }}>
            <strong className="small">Skipped today</strong>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {session.data.skips.map((skip) => (
                <div key={skip.id} className="row row--between">
                  <span className="grow small">
                    {exerciseName.get(skip.exerciseId) ?? 'Exercise'}
                    {skip.reason && (
                      <span className="tiny faint" style={{ display: 'block' }}>
                        {skip.reason}
                      </span>
                    )}
                  </span>
                  <button
                    className="btn btn--sm btn--ghost"
                    onClick={() => unskipExercise(skip.regimenItemId)}
                  >
                    Put back
                  </button>
                </div>
              ))}
            </div>
          </div>
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

      {skipping && (
        <SkipSheet
          name={exerciseName.get(skipping.exerciseId) ?? 'this exercise'}
          onSkip={(reason) => skipExercise(skipping, reason)}
          onClose={() => setSkipping(null)}
        />
      )}

      {restBarShowing && <RestBar rest={rest} />}

      {rest.open && rest.state && (
        <RestTimer rest={rest}>
          {rating && (
            <EffortPicker
              name={exerciseName.get(rating.exerciseId) ?? 'that'}
              value={effortFor(rating.exerciseId)}
              onPick={(effort) => rateEffort(rating, effort)}
            />
          )}
        </RestTimer>
      )}
    </>
  );
}

/** What comes next, for the rest sheet to show while you wait. */
function describeStep(
  next: WorkoutStep | undefined,
  exerciseName: Map<number, string>,
): string {
  if (!next) return 'Last set — workout done after this';
  return `Next: ${exerciseName.get(next.item.exerciseId) ?? 'next exercise'}, set ${
    next.setIndex + 1
  } of ${next.item.sets}`;
}

/**
 * How the exercise felt, asked once its last set is in.
 *
 * Only the lifter can judge this, and it is the one thing needed to know
 * whether to put more on the bar next time. Easy does exactly that; ok and hard
 * both hold the weight where it is, and are worth recording so the history says
 * why nothing moved.
 */
const EFFORTS: Array<{ value: Effort; label: string }> = [
  { value: 'easy', label: 'Easy' },
  { value: 'ok', label: 'OK' },
  { value: 'hard', label: 'Hard' },
];

function EffortPicker({
  name,
  value,
  onPick,
}: {
  name: string;
  value: Effort | null;
  onPick: (effort: Effort) => void;
}) {
  return (
    <div className="effort">
      <p className="effort__ask small">How did {name} feel?</p>
      <div className="effort__row">
        {EFFORTS.map((option) => (
          <button
            key={option.value}
            className={`btn effort__btn${
              value === option.value ? ` effort__btn--on effort__btn--${option.value}` : ''
            }`}
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="tiny faint effort__note">
        {value === 'easy'
          ? 'Next time starts one increment heavier.'
          : 'Easy puts one more increment on the bar next time.'}
      </p>
    </div>
  );
}

/** Why an exercise was passed over. The usual answers, plus room to say more. */
const SKIP_REASONS = [
  'Equipment in use',
  'Niggle or pain',
  'Short on time',
  'Did something else',
  'Too tired',
];

function SkipSheet({
  name,
  onSkip,
  onClose,
}: {
  name: string;
  onSkip: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Sheet title={`Skip ${name}?`} onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          It drops out of today&rsquo;s workout and the reason is kept with it. Tap it in the strip
          at the top to put it back.
        </p>

        <div className="row row--wrap" style={{ gap: 8 }}>
          {SKIP_REASONS.map((option) => (
            <button
              key={option}
              className={`btn btn--sm ${reason === option ? 'btn--primary' : ''}`}
              onClick={() => setReason(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="skip-reason">Reason</label>
          <input
            id="skip-reason"
            className="input"
            value={reason}
            placeholder="Optional"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <button
          className="btn btn--primary btn--block btn--lg"
          onClick={() => onSkip(reason.trim())}
        >
          Skip it
        </button>
        <button className="btn btn--ghost btn--block" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** What to hang on the bar — the thing you actually need while standing over it. */
function PlateBreakdown({ bar, targetKg }: { bar: Equipment; targetKg: number | null }) {
  const plan = useLoadPlan(bar.id, targetKg);

  if (targetKg === null) {
    return (
      <p className="tiny faint" style={{ margin: '10px 0 0' }}>
        {bar.name} weighs {formatWeight(bar.barWeightKg)} kg on its own.
      </p>
    );
  }

  const perSide = plan.data?.plans[0]?.perSide;

  if (plan.isLoading) {
    return (
      <p className="tiny faint" style={{ margin: '10px 0 0' }}>
        Working out the plates…
      </p>
    );
  }

  if (!perSide) {
    return (
      <p className="tiny" style={{ margin: '10px 0 0', color: 'var(--warn)' }}>
        Your plates can't make {formatWeight(targetKg)} kg on the {bar.name}.
      </p>
    );
  }

  return (
    <p className="tiny faint num" style={{ margin: '10px 0 0' }}>
      {formatWeight(bar.barWeightKg)} kg bar
      {perSide.length === 0
        ? ' — no plates'
        : ` + ${perSide.map((s) => `${s.count} × ${formatWeight(s.weightKg)}`).join(' + ')} per side`}
    </p>
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
