import { useMemo, useState } from 'react';
import type { Equipment } from '../../../shared/types';
import type { EquipmentInput } from '../api';
import {
  EmptyState,
  ErrorBanner,
  IconPlus,
  IconTrash,
  Sheet,
  Spinner,
} from '../components/ui';
import { EQUIPMENT_KINDS, kindLabel } from '../format';
import {
  useEquipment,
  useEquipmentMutations,
  usePlatePools,
  usePlatePoolMutations,
} from '../queries';

const NEW_POOL = '__new__';

const blank = (): EquipmentInput => ({ name: '', kind: 'barbell', platePoolId: null, notes: '' });

export default function EquipmentPage() {
  const equipment = useEquipment();
  const pools = usePlatePools();
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null);
  const [managingPools, setManagingPools] = useState(false);

  const poolName = useMemo(
    () => new Map((pools.data ?? []).map((p) => [p.id, p.name])),
    [pools.data],
  );

  const grouped = useMemo(() => {
    const byKind = new Map<Equipment['kind'], Equipment[]>();
    for (const item of equipment.data ?? []) {
      const list = byKind.get(item.kind) ?? [];
      list.push(item);
      byKind.set(item.kind, list);
    }
    return [...byKind.entries()];
  }, [equipment.data]);

  return (
    <>
      <header className="header">
        <h1>Equipment</h1>
        <button className="btn btn--sm btn--ghost" onClick={() => setManagingPools(true)}>
          Plate pools
        </button>
        <button
          className="btn btn--icon btn--primary"
          onClick={() => setEditing('new')}
          aria-label="Add equipment"
        >
          <IconPlus />
        </button>
      </header>

      <main className="main">
        <ErrorBanner error={equipment.error} />

        {equipment.isLoading ? (
          <Spinner />
        ) : (equipment.data ?? []).length === 0 ? (
          <EmptyState
            title="No equipment yet"
            hint="Add what you have in the gym. Bars that share a set of plates go in the same plate pool, so Forklift knows they can't be used back to back."
            action={
              <button className="btn btn--primary" onClick={() => setEditing('new')}>
                Add equipment
              </button>
            }
          />
        ) : (
          grouped.map(([kind, items]) => (
            <section key={kind}>
              <h2 className="section-title">{kindLabel(kind)}</h2>
              <div className="card card--flush">
                <div className="list">
                  {items.map((item) => (
                    <button key={item.id} className="list__row" onClick={() => setEditing(item)}>
                      <span className="grow">
                        <span className="list__title">{item.name}</span>
                        {item.notes && (
                          <span className="small muted truncate" style={{ display: 'block' }}>
                            {item.notes}
                          </span>
                        )}
                      </span>
                      {item.platePoolId !== null && (
                        <span className="chip chip--pool">
                          {poolName.get(item.platePoolId) ?? 'Pool'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ))
        )}

        {(equipment.data ?? []).some((e) => e.platePoolId !== null) && (
          <p className="tiny faint" style={{ marginTop: 18 }}>
            Equipment tagged with a plate pool shares one set of plates. Two exercises using the
            same pool can't be supersetted — the plates would have to be swapped between sets.
          </p>
        )}
      </main>

      {editing && (
        <EquipmentSheet
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {managingPools && <PlatePoolSheet onClose={() => setManagingPools(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ sheets */

function EquipmentSheet({ initial, onClose }: { initial: Equipment | null; onClose: () => void }) {
  const pools = usePlatePools();
  const { create, update, remove } = useEquipmentMutations();
  const poolMutations = usePlatePoolMutations();

  const [form, setForm] = useState<EquipmentInput>(
    initial
      ? {
          name: initial.name,
          kind: initial.kind,
          platePoolId: initial.platePoolId,
          notes: initial.notes,
        }
      : blank(),
  );
  const [newPoolName, setNewPoolName] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const busy = create.isPending || update.isPending || remove.isPending || poolMutations.create.isPending;

  async function save() {
    setError(null);
    try {
      let platePoolId = form.platePoolId;
      // Creating a pool inline saves a trip to the plate-pool sheet.
      if (newPoolName !== null) {
        const trimmed = newPoolName.trim();
        if (!trimmed) throw new Error('Give the plate pool a name');
        platePoolId = (await poolMutations.create.mutateAsync(trimmed)).id;
      }
      const input = { ...form, name: form.name.trim(), platePoolId };
      if (!input.name) throw new Error('Give the equipment a name');

      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  async function destroy() {
    if (!initial) return;
    if (!confirm(`Delete ${initial.name}? Exercises using it will lose the requirement.`)) return;
    setError(null);
    try {
      await remove.mutateAsync(initial.id);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet title={initial ? 'Edit equipment' : 'Add equipment'} onClose={onClose}>
      <div className="stack">
        <ErrorBanner error={error} />

        <div className="field">
          <label htmlFor="eq-name">Name</label>
          <input
            id="eq-name"
            className="input"
            value={form.name}
            autoFocus={!initial}
            placeholder="Barbell"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="eq-kind">Kind</label>
          <select
            id="eq-kind"
            className="select"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as Equipment['kind'] })}
          >
            {EQUIPMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="eq-pool">Plate pool</label>
          <select
            id="eq-pool"
            className="select"
            value={newPoolName !== null ? NEW_POOL : (form.platePoolId ?? '')}
            onChange={(e) => {
              const value = e.target.value;
              if (value === NEW_POOL) {
                setNewPoolName('');
              } else {
                setNewPoolName(null);
                setForm({ ...form, platePoolId: value === '' ? null : Number(value) });
              }
            }}
          >
            <option value="">None — loads independently</option>
            {(pools.data ?? []).map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
            <option value={NEW_POOL}>+ New plate pool…</option>
          </select>
          {newPoolName !== null && (
            <input
              className="input"
              autoFocus
              placeholder="e.g. Main plates"
              value={newPoolName}
              onChange={(e) => setNewPoolName(e.target.value)}
            />
          )}
          <p className="tiny faint" style={{ margin: 0 }}>
            Pick the same pool for bars that share one set of plates, like a barbell and an ez-bar.
          </p>
        </div>

        <div className="field">
          <label htmlFor="eq-notes">Notes</label>
          <input
            id="eq-notes"
            className="input"
            value={form.notes}
            placeholder="20 kg bar, 2× collars"
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <button className="btn btn--primary btn--block btn--lg" onClick={save} disabled={busy}>
          {initial ? 'Save' : 'Add equipment'}
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

function PlatePoolSheet({ onClose }: { onClose: () => void }) {
  const pools = usePlatePools();
  const equipment = useEquipment();
  const { create, rename, remove } = usePlatePoolMutations();
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);

  const usage = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const item of equipment.data ?? []) {
      if (item.platePoolId === null) continue;
      const list = map.get(item.platePoolId) ?? [];
      list.push(item.name);
      map.set(item.platePoolId, list);
    }
    return map;
  }, [equipment.data]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await create.mutateAsync(trimmed);
      setName('');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Sheet title="Plate pools" onClose={onClose}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          A plate pool is one physical set of plates. Anything loaded from the same pool can't be
          supersetted, because you'd be moving plates between bars mid-set.
        </p>

        <ErrorBanner error={error} />

        {(pools.data ?? []).map((pool) => (
          <div key={pool.id} className="card">
            <div className="row">
              <input
                className="input grow"
                defaultValue={pool.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== pool.name) {
                    rename.mutate({ id: pool.id, name: next });
                  } else {
                    e.target.value = pool.name;
                  }
                }}
              />
              <button
                className="btn btn--icon btn--danger"
                aria-label={`Delete ${pool.name}`}
                onClick={() => {
                  if (confirm(`Delete "${pool.name}"? Its equipment becomes independent.`)) {
                    remove.mutate(pool.id);
                  }
                }}
              >
                <IconTrash />
              </button>
            </div>
            <p className="tiny faint" style={{ margin: '8px 0 0' }}>
              {usage.get(pool.id)?.join(', ') ?? 'Not used by any equipment yet'}
            </p>
          </div>
        ))}

        <div className="row">
          <input
            className="input grow"
            placeholder="New pool name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button className="btn btn--primary" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>
      </div>
    </Sheet>
  );
}
