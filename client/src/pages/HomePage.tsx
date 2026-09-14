import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorBanner, IconCheck, IconChevron, Spinner } from '../components/ui';
import { formatDate, formatDuration, formatWeight } from '../format';
import {
  useActiveSession,
  useEquipment,
  useExercises,
  useRegimens,
  useSessionHistory,
} from '../queries';

export default function HomePage() {
  const equipment = useEquipment();
  const exercises = useExercises();
  const regimens = useRegimens();
  const active = useActiveSession();
  const history = useSessionHistory(3);
  const navigate = useNavigate();

  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loading =
    equipment.isLoading || exercises.isLoading || regimens.isLoading || active.isLoading;

  async function start(regimenId: number) {
    setError(null);
    setStarting(regimenId);
    try {
      const session = await api.sessions.start(regimenId);
      navigate(`/workout/${session.id}`);
    } catch (err) {
      setError(err);
      setStarting(null);
    }
  }

  const steps = [
    {
      done: (equipment.data ?? []).length > 0,
      label: 'Add your equipment',
      to: '/equipment',
    },
    {
      done: (exercises.data ?? []).length > 0,
      label: 'Add the exercises you do',
      to: '/exercises',
    },
    {
      done: (regimens.data ?? []).some((r) => r.items.length > 0),
      label: 'Build a regimen',
      to: '/regimens',
    },
  ];
  const setupComplete = steps.every((step) => step.done);

  return (
    <>
      <header className="header">
        <h1>Forklift</h1>
      </header>

      <main className="main">
        <ErrorBanner error={error} />

        {loading ? (
          <Spinner />
        ) : (
          <>
            {active.data && (
              <div className="card card--accent">
                <p className="tiny faint" style={{ margin: 0, letterSpacing: '0.08em' }}>
                  IN PROGRESS
                </p>
                <div className="row row--between" style={{ marginTop: 4 }}>
                  <div className="grow">
                    <h2 style={{ fontSize: '1.15rem' }}>{active.data.regimenName}</h2>
                    <p className="small muted" style={{ margin: '2px 0 0' }}>
                      {formatDuration(active.data.startedAt, null)} in ·{' '}
                      {active.data.sets.length} sets logged
                    </p>
                  </div>
                  <Link className="btn btn--primary" to={`/workout/${active.data.id}`}>
                    Resume
                  </Link>
                </div>
              </div>
            )}

            {!setupComplete && (
              <>
                <h2 className="section-title">Get set up</h2>
                <div className="card card--flush">
                  <div className="list">
                    {steps.map((step) => (
                      <Link key={step.to} to={step.to} className="list__row">
                        <span
                          className={`chip${step.done ? ' chip--good' : ''}`}
                          style={{ width: 26, height: 26, justifyContent: 'center', padding: 0 }}
                        >
                          {step.done ? <IconCheck size={14} /> : ''}
                        </span>
                        <span className="grow list__title">{step.label}</span>
                        <IconChevron />
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}

            {setupComplete && !active.data && (
              <>
                <h2 className="section-title">Start a workout</h2>
                <div className="stack">
                  {(regimens.data ?? [])
                    .filter((regimen) => regimen.items.length > 0)
                    .map((regimen) => (
                      <button
                        key={regimen.id}
                        className="card row row--between"
                        onClick={() => start(regimen.id)}
                        disabled={starting !== null}
                        style={{ textAlign: 'left', cursor: 'pointer' }}
                      >
                        <span className="grow">
                          <span style={{ fontSize: '1.1rem', fontWeight: 650 }}>
                            {regimen.name}
                          </span>
                          <span className="small muted" style={{ display: 'block' }}>
                            {regimen.items.length} exercises ·{' '}
                            {regimen.items.reduce((total, item) => total + item.sets, 0)} sets
                          </span>
                        </span>
                        <span className="chip chip--accent">
                          {starting === regimen.id ? 'Starting…' : 'Start'}
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )}

            {(history.data ?? []).length > 0 && (
              <>
                <h2 className="section-title">Recent</h2>
                <div className="card card--flush">
                  <div className="list">
                    {(history.data ?? []).map((entry) => (
                      <div key={entry.id} className="list__row" style={{ cursor: 'default' }}>
                        <span className="grow">
                          <span className="list__title">{entry.regimenName}</span>
                          <span className="small muted" style={{ display: 'block' }}>
                            {formatDate(entry.startedAt)}
                            {entry.endedAt
                              ? ` · ${formatDuration(entry.startedAt, entry.endedAt)}`
                              : ' · unfinished'}
                          </span>
                        </span>
                        <span className="tiny faint num" style={{ textAlign: 'right' }}>
                          {entry.setCount} sets
                          <br />
                          {formatWeight(entry.volumeKg)} kg
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <Link
                  className="btn btn--ghost btn--block"
                  to="/history"
                  style={{ marginTop: 10 }}
                >
                  All history
                </Link>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
