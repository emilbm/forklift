import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, ErrorBanner, IconChevron, IconPlus, Spinner } from '../components/ui';
import { formatPrescription } from '../format';
import { useActiveSession, useExercises, useRegimens } from '../queries';

export default function RegimensPage() {
  const regimens = useRegimens();
  const exercises = useExercises();
  const activeSession = useActiveSession();
  const navigate = useNavigate();
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const exerciseName = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  async function start(regimenId: number) {
    setError(null);
    setStarting(regimenId);
    try {
      if (activeSession.data) {
        const keep = confirm(
          `“${activeSession.data.regimenName}” is still running. Open it instead of starting a new one?`,
        );
        if (keep) {
          navigate(`/workout/${activeSession.data.id}`);
          return;
        }
        await api.sessions.finish(activeSession.data.id);
      }
      const session = await api.sessions.start(regimenId);
      navigate(`/workout/${session.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setStarting(null);
    }
  }

  const noExercises = (exercises.data ?? []).length === 0;

  return (
    <>
      <header className="header">
        <h1>Regimens</h1>
        <Link className="btn btn--icon btn--primary" to="/regimens/new" aria-label="New regimen">
          <IconPlus />
        </Link>
      </header>

      <main className="main">
        <ErrorBanner error={error ?? regimens.error} />

        {noExercises && !exercises.isLoading && (
          <div className="banner banner--info" style={{ marginBottom: 12 }}>
            Add some <Link to="/exercises">exercises</Link> first — a regimen is a list of them.
          </div>
        )}

        {regimens.isLoading ? (
          <Spinner />
        ) : (regimens.data ?? []).length === 0 ? (
          <EmptyState
            title="No regimens yet"
            hint="Build the workouts you cycle through — A, B, C — each with its exercises, sets and reps."
            action={
              <Link className="btn btn--primary" to="/regimens/new">
                New regimen
              </Link>
            }
          />
        ) : (
          (regimens.data ?? []).map((regimen) => (
            <div key={regimen.id} className="card">
              <div className="row row--between">
                <Link
                  to={`/regimens/${regimen.id}`}
                  className="grow"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <div className="row" style={{ gap: 6 }}>
                    <h2 style={{ fontSize: '1.05rem' }}>{regimen.name}</h2>
                    <IconChevron size={16} />
                  </div>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    {regimen.items.length} exercise{regimen.items.length === 1 ? '' : 's'} ·{' '}
                    {regimen.items.reduce((total, item) => total + item.sets, 0)} sets
                  </p>
                </Link>
                <button
                  className="btn btn--primary"
                  onClick={() => start(regimen.id)}
                  disabled={starting !== null || regimen.items.length === 0}
                >
                  {starting === regimen.id ? 'Starting…' : 'Start'}
                </button>
              </div>

              {regimen.items.length > 0 && (
                <ol
                  className="small muted"
                  style={{ margin: '10px 0 0', paddingLeft: 20, lineHeight: 1.7 }}
                >
                  {regimen.items.map((item) => (
                    <li key={item.id}>
                      {exerciseName.get(item.exerciseId) ?? 'Unknown exercise'}{' '}
                      <span className="faint num">{formatPrescription(item)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))
        )}
      </main>
    </>
  );
}
