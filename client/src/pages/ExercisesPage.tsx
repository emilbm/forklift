import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Exercise } from '../../../shared/types';
import type { ExerciseInput } from '../api';
import { EmptyState, ErrorBanner, IconPlus, IconTrash, Sheet, Spinner } from '../components/ui';
import { useEquipment, useExerciseMutations, useExercises } from '../queries';

export default function ExercisesPage() {
  const exercises = useExercises();
  const equipment = useEquipment();
  const [editing, setEditing] = useState<Exercise | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const equipmentName = useMemo(
    () => new Map((equipment.data ?? []).map((e) => [e.id, e.name])),
    [equipment.data],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = exercises.data ?? [];
    return term ? list.filter((e) => e.name.toLowerCase().includes(term)) : list;
  }, [exercises.data, search]);

  const noEquipment = (equipment.data ?? []).length === 0;

  return (
    <>
      <header className="header">
        <h1>Exercises</h1>
        <button
          className="btn btn--icon btn--primary"
          onClick={() => setEditing('new')}
          disabled={noEquipment}
          aria-label="Add exercise"
        >
          <IconPlus />
        </button>
      </header>

      <main className="main">
        <ErrorBanner error={exercises.error} />

        {noEquipment && !equipment.isLoading && (
          <div className="banner banner--info" style={{ marginBottom: 12 }}>
            Add your <Link to="/equipment">equipment</Link> first — exercises are defined by what
            they need.
          </div>
        )}

        {exercises.isLoading ? (
          <Spinner />
        ) : (exercises.data ?? []).length === 0 ? (
          <EmptyState
            title="No exercises yet"
            hint="Add the lifts you do and tick the equipment each one needs."
            action={
              <button
                className="btn btn--primary"
                onClick={() => setEditing('new')}
                disabled={noEquipment}
              >
                Add exercise
              </button>
            }
          />
        ) : (
          <>
            {(exercises.data ?? []).length > 6 && (
              <input
                className="input"
                placeholder="Search exercises"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ marginBottom: 12 }}
              />
            )}

            <div className="card card--flush">
              <div className="list">
                {visible.map((exercise) => (
                  <button
                    key={exercise.id}
                    className="list__row"
                    onClick={() => setEditing(exercise)}
                  >
                    <span className="grow">
                      <span className="list__title">{exercise.name}</span>
                      <span
                        className="row row--wrap"
                        style={{ gap: 5, marginTop: 5 }}
                      >
                        {exercise.equipmentIds.length === 0 ? (
                          <span className="chip">Bodyweight</span>
                        ) : (
                          exercise.equipmentIds.map((id) => (
                            <span key={id} className="chip">
                              {equipmentName.get(id) ?? 'Unknown'}
                            </span>
                          ))
                        )}
                      </span>
                    </span>
                  </button>
                ))}
                {visible.length === 0 && (
                  <div className="list__row muted">No exercise matches “{search}”</div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {editing && (
        <ExerciseSheet
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ExerciseSheet({ initial, onClose }: { initial: Exercise | null; onClose: () => void }) {
  const equipment = useEquipment();
  const { create, update, remove } = useExerciseMutations();

  const [form, setForm] = useState<ExerciseInput>(
    initial
      ? { name: initial.name, notes: initial.notes, equipmentIds: [...initial.equipmentIds] }
      : { name: '', notes: '', equipmentIds: [] },
  );
  const [error, setError] = useState<unknown>(null);
  const busy = create.isPending || update.isPending || remove.isPending;

  const toggle = (id: number) =>
    setForm((prev) => ({
      ...prev,
      equipmentIds: prev.equipmentIds.includes(id)
        ? prev.equipmentIds.filter((existing) => existing !== id)
        : [...prev.equipmentIds, id],
    }));

  async function save() {
    setError(null);
    try {
      const input = { ...form, name: form.name.trim() };
      if (!input.name) throw new Error('Give the exercise a name');
      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  async function destroy() {
    if (!initial) return;
    if (!confirm(`Delete ${initial.name}? Its logged sets go too.`)) return;
    setError(null);
    try {
      await remove.mutateAsync(initial.id);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet title={initial ? 'Edit exercise' : 'Add exercise'} onClose={onClose}>
      <div className="stack">
        <ErrorBanner error={error} />

        <div className="field">
          <label htmlFor="ex-name">Name</label>
          <input
            id="ex-name"
            className="input"
            value={form.name}
            autoFocus={!initial}
            placeholder="Back Squat"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Equipment needed</label>
          <div className="stack" style={{ gap: 6 }}>
            {(equipment.data ?? []).map((item) => {
              const on = form.equipmentIds.includes(item.id);
              return (
                <label key={item.id} className={`checkline${on ? ' checkline--on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                  <span className="grow">{item.name}</span>
                </label>
              );
            })}
          </div>
          <p className="tiny faint" style={{ margin: 0 }}>
            Leave everything unticked for bodyweight work.
          </p>
        </div>

        <div className="field">
          <label htmlFor="ex-notes">Notes</label>
          <input
            id="ex-notes"
            className="input"
            value={form.notes}
            placeholder="Pause at the bottom"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <button className="btn btn--primary btn--block btn--lg" onClick={save} disabled={busy}>
          {initial ? 'Save' : 'Add exercise'}
        </button>
        {initial && (
          <button className="btn btn--danger btn--block" onClick={destroy} disabled={busy}>
            <IconTrash /> Delete
          </button>
        )}
      </div>
    </Sheet>
  );
}
