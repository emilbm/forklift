import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { RegimenInput } from '../api';
import {
  ErrorBanner,
  IconClose,
  IconDown,
  IconPlus,
  IconTrash,
  IconUp,
  Sheet,
  Spinner,
  useConfirm,
} from '../components/ui';
import { formatReps, formatWeight } from '../format';
import {
  useEquipment,
  useExercises,
  useRegimen,
  useRegimenMutations,
  useSupersetPairs,
} from '../queries';

type Draft = RegimenInput['items'][number];

const REST_CHOICES = [60, 90, 120];

const newItem = (exerciseId: number): Draft => ({
  exerciseId,
  sets: 3,
  repsMin: 8,
  repsMax: 12,
  restSeconds: 90,
  supersetWithNext: false,
  notes: '',
});

export default function RegimenEditPage() {
  const params = useParams<{ id: string }>();
  const regimenId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();

  const existing = useRegimen(regimenId);
  const exercises = useExercises();
  const equipment = useEquipment();
  const { create, update, remove } = useRegimenMutations();
  const { confirm, dialog } = useConfirm();

  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Draft[]>([]);
  const [loaded, setLoaded] = useState(regimenId === null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!existing.data || loaded) return;
    setName(existing.data.name);
    setNotes(existing.data.notes);
    setItems(
      existing.data.items.map((item) => ({
        exerciseId: item.exerciseId,
        sets: item.sets,
        repsMin: item.repsMin,
        repsMax: item.repsMax,
        restSeconds: item.restSeconds,
        supersetWithNext: item.supersetWithNext,
        notes: item.notes,
      })),
    );
    setLoaded(true);
  }, [existing.data, loaded]);

  const exerciseName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  const exerciseById = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e])),
    [exercises.data],
  );

  const equipmentName = useMemo(
    () => new Map((equipment.data ?? []).map((e) => [e.id, e.name])),
    [equipment.data],
  );

  const patch = (index: number, changes: Partial<Draft>) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  /**
   * Equipment both exercises need. A superset alternates set for set, so sharing
   * a bench or a bar makes it impossible rather than merely awkward — the server
   * rejects it too, this just says so before you save.
   */
  const clashBetween = (first: Draft | undefined, second: Draft | undefined): string | null => {
    if (!first || !second) return null;
    const a = exerciseById.get(first.exerciseId);
    const b = exerciseById.get(second.exerciseId);
    if (!a || !b) return null;
    const shared = a.equipmentIds.filter((id) => b.equipmentIds.includes(id));
    if (shared.length === 0) return null;
    return `Both need ${shared.map((id) => equipmentName.get(id) ?? 'the same equipment').join(', ')}.`;
  };

  const toggleSuperset = (index: number) => {
    const clash = clashBetween(items[index], items[index + 1]);
    if (clash && !items[index]?.supersetWithNext) {
      setError(new Error(`Can't superset these two. ${clash}`));
      return;
    }
    setError(null);
    patch(index, { supersetWithNext: !items[index]?.supersetWithNext });
  };

  const move = (index: number, delta: number) =>
    setItems((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      // Reordering would otherwise leave a link pointing at a new neighbour that
      // might share equipment, so the two items involved are unlinked.
      return next.map((entry, i) =>
        i === target || i === target - 1 || i === index || i === index - 1
          ? { ...entry, supersetWithNext: false }
          : entry,
      );
    });

  async function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(new Error('Give the regimen a name'));
      return;
    }
    // A max below the min reads as a typo, not an intent; normalise rather than reject.
    const cleaned = items.map((item) => ({
      ...item,
      repsMax: Math.max(item.repsMin, item.repsMax),
    }));
    try {
      const input: RegimenInput = { name: trimmed, notes, items: cleaned };
      if (regimenId === null) await create.mutateAsync(input);
      else await update.mutateAsync({ id: regimenId, input });
      navigate('/regimens');
    } catch (err) {
      setError(err);
    }
  }

  async function destroy() {
    if (regimenId === null) return;
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: 'Past workouts stay in your history.',
      confirmLabel: 'Delete regimen',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(regimenId);
      navigate('/regimens');
    } catch (err) {
      setError(err);
    }
  }

  const busy = create.isPending || update.isPending || remove.isPending;

  if (regimenId !== null && existing.isLoading) {
    return (
      <>
        <header className="header">
          <h1>Regimen</h1>
        </header>
        <main className="main">
          <Spinner />
        </main>
      </>
    );
  }

  return (
    <>
      <header className="header">
        <button
          className="btn btn--icon btn--quiet"
          onClick={() => navigate('/regimens')}
          aria-label="Back"
        >
          <IconClose />
        </button>
        <h1>{regimenId === null ? 'New regimen' : 'Edit regimen'}</h1>
        <button className="btn btn--sm btn--primary" onClick={save} disabled={busy}>
          Save
        </button>
      </header>

      <main className="main">
        <div className="stack">
          <ErrorBanner error={error} />

          <div className="field">
            <label htmlFor="rg-name">Name</label>
            <input
              id="rg-name"
              className="input"
              value={name}
              placeholder="A — Fullbody"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <h2 className="section-title">Exercises</h2>

          {items.length === 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              No exercises yet. Add the lifts in the order you'll do them.
            </p>
          )}

          {items.map((item, index) => (
            <div key={`${item.exerciseId}-${index}`}>
            <div className="card">
              <div className="row row--between" style={{ marginBottom: 10 }}>
                <span className="grow">
                  <span className="faint tiny num">{index + 1}</span>{' '}
                  <strong>{exerciseName.get(item.exerciseId) ?? 'Unknown exercise'}</strong>
                </span>
                <button
                  className="btn btn--sm btn--quiet btn--icon"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label="Move up"
                >
                  <IconUp />
                </button>
                <button
                  className="btn btn--sm btn--quiet btn--icon"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  aria-label="Move down"
                >
                  <IconDown />
                </button>
                <button
                  className="btn btn--sm btn--quiet btn--icon"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="Remove"
                >
                  <IconTrash />
                </button>
              </div>

              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div className="field" style={{ width: 74 }}>
                  <label htmlFor={`sets-${index}`}>Sets</label>
                  <input
                    id={`sets-${index}`}
                    className="input input--num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={20}
                    value={item.sets}
                    onChange={(e) => patch(index, { sets: clamp(e.target.value, 1, 20, 3) })}
                  />
                </div>
                <div className="field" style={{ width: 74 }}>
                  <label htmlFor={`min-${index}`}>Reps</label>
                  <input
                    id={`min-${index}`}
                    className="input input--num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={item.repsMin}
                    onChange={(e) => patch(index, { repsMin: clamp(e.target.value, 1, 100, 8) })}
                  />
                </div>
                <div className="field" style={{ width: 74 }}>
                  <label htmlFor={`max-${index}`}>to</label>
                  <input
                    id={`max-${index}`}
                    className="input input--num"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={item.repsMax}
                    onChange={(e) => patch(index, { repsMax: clamp(e.target.value, 1, 100, 12) })}
                  />
                </div>
                <div className="field grow">
                  <label htmlFor={`rest-${index}`}>Rest</label>
                  <select
                    id={`rest-${index}`}
                    className="select"
                    value={REST_CHOICES.includes(item.restSeconds) ? item.restSeconds : 'custom'}
                    onChange={(e) =>
                      e.target.value !== 'custom' &&
                      patch(index, { restSeconds: Number(e.target.value) })
                    }
                  >
                    {REST_CHOICES.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {seconds}s
                      </option>
                    ))}
                    {!REST_CHOICES.includes(item.restSeconds) && (
                      <option value="custom">{item.restSeconds}s</option>
                    )}
                  </select>
                </div>
              </div>

              <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                {item.sets} × {formatReps(item)} reps,{' '}
                {item.supersetWithNext
                  ? 'rest after the pair'
                  : `${item.restSeconds}s between sets`}
              </p>
            </div>

            {index < items.length - 1 && (
              <SupersetLink
                linked={item.supersetWithNext}
                clash={clashBetween(item, items[index + 1])}
                onToggle={() => toggleSuperset(index)}
              />
            )}
            </div>
          ))}

          <button
            className="btn btn--ghost btn--block"
            onClick={() => setPicking(true)}
            disabled={(exercises.data ?? []).length === 0}
          >
            <IconPlus /> Add exercise
          </button>

          {regimenId !== null && <SupersetSummary regimenId={regimenId} />}

          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="rg-notes">Notes</label>
            <textarea
              id="rg-notes"
              className="textarea"
              value={notes}
              placeholder="Anything to remember about this day"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <button className="btn btn--primary btn--block btn--lg" onClick={save} disabled={busy}>
            Save regimen
          </button>
          {regimenId !== null && (
            <button className="btn btn--danger btn--block" onClick={destroy} disabled={busy}>
              <IconTrash /> Delete regimen
            </button>
          )}
        </div>
      </main>

      {dialog}

      {picking && (
        <ExercisePicker
          onPick={(id) => {
            setItems((prev) => [...prev, newItem(id)]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/**
 * The join between two consecutive exercises. Linked means they're alternated
 * set for set with no rest in between; equipment they share makes that
 * impossible, so the control says why instead of offering it.
 */
function SupersetLink({
  linked,
  clash,
  onToggle,
}: {
  linked: boolean;
  clash: string | null;
  onToggle: () => void;
}) {
  if (clash && !linked) {
    return (
      <p className="tiny faint" style={{ margin: '6px 0 0', paddingLeft: 14 }}>
        Can't superset with the next one — {clash.replace(/^Both need /, 'both need ')}
      </p>
    );
  }

  return (
    <div className="superset-link">
      <button
        className={`btn btn--sm ${linked ? 'btn--primary' : 'btn--ghost'}`}
        onClick={onToggle}
      >
        {linked ? '⇄ Supersetted' : '⇄ Superset with next'}
      </button>
      {linked && (
        <span className="tiny faint">Alternate sets, no rest between them</span>
      )}
    </div>
  );
}

function clamp(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Which pairs in the saved regimen could be supersetted. Judged on the equipment
 * and on whether the plates can make both loads at once, using the weights from
 * last time. Reflects the last save, so it lags unsaved edits — the note says so
 * rather than pretending otherwise.
 */
function SupersetSummary({ regimenId }: { regimenId: number }) {
  const pairs = useSupersetPairs(regimenId);
  const exercises = useExercises();
  const [open, setOpen] = useState(false);

  const name = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  if (!pairs.data || pairs.data.length === 0) return null;

  const compatible = pairs.data.filter((pair) => pair.compatible);
  const blocked = pairs.data.filter((pair) => !pair.compatible);
  const label = (id: number) => name.get(id) ?? 'Unknown exercise';

  /** The weights the plate check was judged against, when both are known. */
  const basisNote = (pair: (typeof pairs.data)[number]) => {
    const known = pair.basis.filter((b) => b.weightKg !== null);
    if (known.length < pair.basis.length) return 'No weights logged yet — plates not checked.';
    return `At ${known.map((b) => `${formatWeight(b.weightKg)} kg`).join(' and ')}.`;
  };

  return (
    <div className="card">
      <button
        className="row row--between"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        <strong className="small">Superset options</strong>
        <span className="chip chip--good">{compatible.length} possible</span>
      </button>

      {open && (
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          {compatible.map((pair) => (
            <p key={pair.exerciseIds.join('-')} className="small" style={{ margin: 0 }}>
              <span className="chip chip--good">OK</span> {label(pair.exerciseIds[0])} +{' '}
              {label(pair.exerciseIds[1])}
              <span className="tiny faint" style={{ display: 'block', paddingLeft: 4 }}>
                {basisNote(pair)}
              </span>
            </p>
          ))}
          {blocked.map((pair) => (
            <p key={pair.exerciseIds.join('-')} className="small muted" style={{ margin: 0 }}>
              <span className="chip chip--pool">No</span> {label(pair.exerciseIds[0])} +{' '}
              {label(pair.exerciseIds[1])}
              <span className="tiny faint" style={{ display: 'block', paddingLeft: 4 }}>
                {pair.conflicts[0]?.detail}
              </span>
            </p>
          ))}
          <p className="tiny faint" style={{ margin: '4px 0 0' }}>
            Based on the last saved version, the equipment, and the plates you own.
          </p>
        </div>
      )}
    </div>
  );
}

function ExercisePicker({
  onPick,
  onClose,
}: {
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const exercises = useExercises();
  const [search, setSearch] = useState('');

  const visible = (exercises.data ?? []).filter((e) =>
    e.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Sheet title="Add exercise" onClose={onClose}>
      <div className="stack">
        <input
          className="input"
          autoFocus
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="card card--flush">
          <div className="list">
            {visible.map((exercise) => (
              <button
                key={exercise.id}
                className="list__row"
                onClick={() => onPick(exercise.id)}
              >
                <span className="grow list__title">{exercise.name}</span>
                <IconPlus />
              </button>
            ))}
            {visible.length === 0 && <div className="list__row muted">Nothing matches</div>}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
