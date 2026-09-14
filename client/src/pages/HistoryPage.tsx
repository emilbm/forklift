import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SetLog } from '../../../shared/types';
import { api } from '../api';
import { EmptyState, ErrorBanner, IconTrash, Sheet, Spinner } from '../components/ui';
import { formatDate, formatDuration, formatWeight } from '../format';
import { invalidateSessions, useExercises, useSession, useSessionHistory } from '../queries';

export default function HistoryPage() {
  const history = useSessionHistory(60);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <header className="header">
        <h1>History</h1>
      </header>

      <main className="main">
        <ErrorBanner error={history.error} />

        {history.isLoading ? (
          <Spinner />
        ) : (history.data ?? []).length === 0 ? (
          <EmptyState
            title="No workouts logged"
            hint="Finished sessions show up here with their sets and volume."
            action={
              <Link className="btn btn--primary" to="/">
                Start one
              </Link>
            }
          />
        ) : (
          <div className="card card--flush">
            <div className="list">
              {(history.data ?? []).map((entry) => (
                <button key={entry.id} className="list__row" onClick={() => setOpen(entry.id)}>
                  <span className="grow">
                    <span className="list__title">{entry.regimenName}</span>
                    <span className="small muted" style={{ display: 'block' }}>
                      {formatDate(entry.startedAt)}
                      {entry.endedAt ? (
                        ` · ${formatDuration(entry.startedAt, entry.endedAt)}`
                      ) : (
                        <span className="chip chip--pool" style={{ marginLeft: 6 }}>
                          unfinished
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="tiny faint num" style={{ textAlign: 'right' }}>
                    {entry.setCount} sets
                    <br />
                    {entry.totalReps} reps
                    <br />
                    {formatWeight(entry.volumeKg)} kg
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {open !== null && <SessionSheet sessionId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SessionSheet({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const session = useSession(sessionId);
  const exercises = useExercises();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  const name = useMemo(
    () => new Map((exercises.data ?? []).map((e) => [e.id, e.name])),
    [exercises.data],
  );

  const grouped = useMemo(() => {
    const map = new Map<number, SetLog[]>();
    for (const log of session.data?.sets ?? []) {
      const list = map.get(log.exerciseId) ?? [];
      list.push(log);
      map.set(log.exerciseId, list);
    }
    return [...map.entries()];
  }, [session.data?.sets]);

  async function destroy() {
    if (!confirm('Delete this workout from your history?')) return;
    try {
      await api.sessions.remove(sessionId);
      invalidateSessions(qc, sessionId);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet title={session.data?.regimenName ?? 'Workout'} onClose={onClose}>
      {session.isLoading || !session.data ? (
        <Spinner />
      ) : (
        <div className="stack">
          <ErrorBanner error={error} />

          <p className="small muted" style={{ margin: 0 }}>
            {formatDate(session.data.startedAt)} ·{' '}
            {formatDuration(session.data.startedAt, session.data.endedAt)}
            {session.data.endedAt === null && ' (unfinished)'}
          </p>

          {session.data.notes && <p className="small">{session.data.notes}</p>}

          {grouped.map(([exerciseId, logs]) => (
            <div key={exerciseId} className="card">
              <strong>{name.get(exerciseId) ?? 'Exercise'}</strong>
              <p className="small muted num" style={{ margin: '4px 0 0' }}>
                {logs.map((log) => `${log.reps} × ${formatWeight(log.weightKg)}`).join('  ·  ')} kg
              </p>
            </div>
          ))}

          {grouped.length === 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              No sets logged.
            </p>
          )}

          <button className="btn btn--danger btn--block" onClick={destroy}>
            <IconTrash /> Delete workout
          </button>
        </div>
      )}
    </Sheet>
  );
}
