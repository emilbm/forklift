import { useMemo, useState } from 'react';
import type { Equipment } from '../../../shared/types';
import type { EquipmentInput } from '../api';
import {
  DecimalInput,
  EmptyState,
  ErrorBanner,
  IconPlus,
  IconTrash,
  Sheet,
  Spinner,
  useConfirm,
} from '../components/ui';
import { EQUIPMENT_KINDS, formatWeight, kindLabel } from '../format';
import { useEquipment, useEquipmentMutations, usePlateMutations, usePlates } from '../queries';

/** Denominations most home gyms are built from, offered as one-tap adds. */
const COMMON_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

const blank = (): EquipmentInput => ({
  name: '',
  kind: 'barbell',
  usesPlates: true,
  barWeightKg: 20,
  incrementKg: 0,
  minWeightKg: 0,
  maxWeightKg: 0,
  supersetFriendly: false,
  notes: '',
});

/** A dumbbell rack is the common case for a fixed ladder, so offer it ready-made. */
const DUMBBELL_LADDER = { incrementKg: 2, minWeightKg: 2, maxWeightKg: 32 };

export default function EquipmentPage() {
  const equipment = useEquipment();
  const plates = usePlates();
  const [editing, setEditing] = useState<Equipment | 'new' | null>(null);
  const [managingPlates, setManagingPlates] = useState(false);

  const grouped = useMemo(() => {
    const byKind = new Map<Equipment['kind'], Equipment[]>();
    for (const item of equipment.data ?? []) {
      const list = byKind.get(item.kind) ?? [];
      list.push(item);
      byKind.set(item.kind, list);
    }
    return [...byKind.entries()];
  }, [equipment.data]);

  const plateCount = (plates.data ?? []).reduce((total, plate) => total + plate.count, 0);
  const usesPlates = (equipment.data ?? []).some((item) => item.usesPlates);

  return (
    <>
      <header className="header">
        <h1>Equipment</h1>
        <button
          className="btn btn--icon btn--primary"
          onClick={() => setEditing('new')}
          aria-label="Add equipment"
        >
          <IconPlus />
        </button>
      </header>

      <main className="main">
        <ErrorBanner error={equipment.error ?? plates.error} />

        <h2 className="section-title">Plates</h2>
        <button
          className="card row row--between"
          onClick={() => setManagingPlates(true)}
          style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <span className="grow">
            <span style={{ fontWeight: 650 }}>
              {plateCount === 0 ? 'No plates yet' : `${plateCount} plates`}
            </span>
            <span className="small muted" style={{ display: 'block' }}>
              {plateCount === 0
                ? 'Add what you own so Forklift knows what you can load'
                : (plates.data ?? [])
                    .map((plate) => `${plate.count}× ${formatWeight(plate.weightKg)}`)
                    .join(', ') + ' kg'}
            </span>
          </span>
          <span className="chip chip--accent">Edit</span>
        </button>
        {usesPlates && (
          <p className="tiny faint" style={{ marginTop: 8 }}>
            One collection, shared by every bar. Two lifts can only be supersetted if their plates
            can be on both bars at once.
          </p>
        )}

        {equipment.isLoading ? (
          <Spinner />
        ) : (equipment.data ?? []).length === 0 ? (
          <EmptyState
            title="No equipment yet"
            hint="Add the bars, benches and machines you have. For anything loaded with plates, record what the bar itself weighs."
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
                      {item.supersetFriendly && <span className="chip">⇄ shareable</span>}
                      {item.usesPlates ? (
                        <span className="chip chip--accent num">
                          {formatWeight(item.barWeightKg)} kg bar
                        </span>
                      ) : (
                        item.incrementKg > 0 && (
                          <span className="chip num">
                            {formatWeight(item.minWeightKg)}–{formatWeight(item.maxWeightKg)} kg /{' '}
                            {formatWeight(item.incrementKg)}
                          </span>
                        )
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ))
        )}
      </main>

      {editing && (
        <EquipmentSheet
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {managingPlates && <PlatesSheet onClose={() => setManagingPlates(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ sheets */

function EquipmentSheet({ initial, onClose }: { initial: Equipment | null; onClose: () => void }) {
  const { create, update, remove } = useEquipmentMutations();
  const { confirm, dialog } = useConfirm();

  const [form, setForm] = useState<EquipmentInput>(
    initial
      ? {
          name: initial.name,
          kind: initial.kind,
          usesPlates: initial.usesPlates,
          barWeightKg: initial.barWeightKg,
          incrementKg: initial.incrementKg,
          minWeightKg: initial.minWeightKg,
          maxWeightKg: initial.maxWeightKg,
          supersetFriendly: initial.supersetFriendly,
          notes: initial.notes,
        }
      : blank(),
  );
  const [error, setError] = useState<unknown>(null);
  const busy = create.isPending || update.isPending || remove.isPending;

  async function save() {
    setError(null);
    try {
      const input = { ...form, name: form.name.trim() };
      if (!input.name) throw new Error('Give the equipment a name');
      if (input.usesPlates) {
        // Plate-loaded gear gets its weights from the plates, not a ladder.
        input.incrementKg = 0;
        input.minWeightKg = 0;
        input.maxWeightKg = 0;
      } else {
        input.barWeightKg = 0;
        if (input.incrementKg > 0 && input.maxWeightKg < input.minWeightKg) {
          throw new Error('The heaviest weight must be at least the lightest');
        }
      }
      if (initial) await update.mutateAsync({ id: initial.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  async function destroy() {
    if (!initial) return;
    const ok = await confirm({
      title: `Delete ${initial.name}?`,
      body: 'Exercises using it will lose the requirement.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await remove.mutateAsync(initial.id);
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
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
              onChange={(e) => {
                const kind = e.target.value as Equipment['kind'];
                // Picking "dumbbell" on new equipment fills in the usual rack.
                const wantsLadder = kind === 'dumbbell' && !initial && form.incrementKg === 0;
                setForm({
                  ...form,
                  kind,
                  ...(wantsLadder ? { usesPlates: false, ...DUMBBELL_LADDER } : {}),
                });
              }}
            >
              {EQUIPMENT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>

          <label className={`checkline${form.usesPlates ? ' checkline--on' : ''}`}>
            <input
              type="checkbox"
              checked={form.usesPlates}
              onChange={(e) => setForm({ ...form, usesPlates: e.target.checked })}
            />
            <span className="grow">Loaded with plates</span>
          </label>

          <label className={`checkline${form.supersetFriendly ? ' checkline--on' : ''}`}>
            <input
              type="checkbox"
              checked={form.supersetFriendly}
              onChange={(e) => setForm({ ...form, supersetFriendly: e.target.checked })}
            />
            <span className="grow">
              Can be shared in a superset
              <span className="tiny faint" style={{ display: 'block', fontWeight: 400 }}>
                Quick enough to hand over between sets — a bench you just re-angle.
              </span>
            </span>
          </label>

          {!form.usesPlates && (
            <div className="field">
              <label>Fixed weights available</label>
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div className="field grow">
                  <label htmlFor="eq-min">From</label>
                  <DecimalInput
                    id="eq-min"
                    className="input input--num"
                    min={0}
                    value={form.minWeightKg}
                    onChange={(next) => setForm({ ...form, minWeightKg: next ?? 0 })}
                  />
                </div>
                <div className="field grow">
                  <label htmlFor="eq-max">To</label>
                  <DecimalInput
                    id="eq-max"
                    className="input input--num"
                    min={0}
                    value={form.maxWeightKg}
                    onChange={(next) => setForm({ ...form, maxWeightKg: next ?? 0 })}
                  />
                </div>
                <div className="field grow">
                  <label htmlFor="eq-step">In steps of</label>
                  <DecimalInput
                    id="eq-step"
                    className="input input--num"
                    min={0}
                    value={form.incrementKg}
                    onChange={(next) => setForm({ ...form, incrementKg: next ?? 0 })}
                  />
                </div>
              </div>
              <p className="tiny faint" style={{ margin: 0 }}>
                {form.kind === 'dumbbell'
                  ? 'Per dumbbell — a rack of 2 to 32 kg in 2 kg steps is 2 / 32 / 2.'
                  : 'The weights this can actually be set to. Leave the step at 0 to type any weight.'}
              </p>
            </div>
          )}

          {form.usesPlates && (
            <div className="field">
              <label htmlFor="eq-bar">Bar weight (kg)</label>
              <DecimalInput
                id="eq-bar"
                className="input input--num"
                min={0}
                value={form.barWeightKg}
                onChange={(next) => setForm({ ...form, barWeightKg: next ?? 0 })}
              />
              <p className="tiny faint" style={{ margin: 0 }}>
                What it weighs empty — 20 kg for a typical barbell, 8.5 kg for many ez-bars. Plates
                go on top of this, in pairs.
              </p>
            </div>
          )}

          <div className="field">
            <label htmlFor="eq-notes">Notes</label>
            <input
              id="eq-notes"
              className="input"
              value={form.notes}
              placeholder="Anything worth remembering"
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
      {dialog}
    </>
  );
}

function PlatesSheet({ onClose }: { onClose: () => void }) {
  const plates = usePlates();
  const { create, update, remove } = usePlateMutations();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<unknown>(null);
  const [customWeight, setCustomWeight] = useState<number | null>(null);

  const owned = plates.data ?? [];
  const ownedWeights = new Set(owned.map((plate) => plate.weightKg));

  async function add(weightKg: number, count = 2) {
    setError(null);
    try {
      await create.mutateAsync({ weightKg, count });
    } catch (err) {
      setError(err);
    }
  }

  async function setCount(id: number, weightKg: number, count: number) {
    setError(null);
    try {
      await update.mutateAsync({ id, input: { weightKg, count: Math.max(0, count) } });
    } catch (err) {
      setError(err);
    }
  }

  async function addCustom() {
    if (customWeight === null || customWeight <= 0) return;
    await add(customWeight);
    setCustomWeight(null);
  }

  return (
    <>
      <Sheet title="Your plates" onClose={onClose}>
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            Every plate you own, counted individually. Bars load in pairs, so two 20s make one
            usable pair. Every plate-loaded bar draws from this one collection.
          </p>

          <ErrorBanner error={error} />

          {owned.length === 0 && (
            <div className="banner banner--info">
              Nothing yet. Tap a size below to add a pair.
            </div>
          )}

          {owned.map((plate) => (
            <div key={plate.id} className="row" style={{ gap: 10 }}>
              <span className="chip chip--accent num" style={{ minWidth: 72, justifyContent: 'center' }}>
                {formatWeight(plate.weightKg)} kg
              </span>
              <button
                className="btn btn--icon"
                onClick={() => setCount(plate.id, plate.weightKg, plate.count - 1)}
                disabled={plate.count === 0}
                aria-label={`One fewer ${plate.weightKg} kg plate`}
              >
                −
              </button>
              <span className="grow num" style={{ textAlign: 'center', fontWeight: 700 }}>
                {plate.count}
                <span className="tiny faint" style={{ display: 'block', fontWeight: 500 }}>
                  {Math.floor(plate.count / 2)} pair{Math.floor(plate.count / 2) === 1 ? '' : 's'}
                </span>
              </span>
              <button
                className="btn btn--icon"
                onClick={() => setCount(plate.id, plate.weightKg, plate.count + 1)}
                aria-label={`One more ${plate.weightKg} kg plate`}
              >
                +
              </button>
              <button
                className="btn btn--icon btn--danger"
                aria-label={`Remove ${plate.weightKg} kg plates`}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Remove ${formatWeight(plate.weightKg)} kg plates?`,
                    body: 'They stop counting towards what you can load.',
                    confirmLabel: 'Remove',
                    danger: true,
                  });
                  if (ok) remove.mutate(plate.id);
                }}
              >
                <IconTrash />
              </button>
            </div>
          ))}

          <h3 className="section-title" style={{ marginBottom: 0 }}>
            Add a size
          </h3>
          <div className="row row--wrap" style={{ gap: 8 }}>
            {COMMON_PLATES.filter((weight) => !ownedWeights.has(weight)).map((weight) => (
              <button key={weight} className="btn btn--sm" onClick={() => add(weight)}>
                + {formatWeight(weight)} kg
              </button>
            ))}
          </div>

          <div className="row" style={{ gap: 8 }}>
            <DecimalInput
              className="input grow input--num"
              min={0.25}
              placeholder="Other size"
              value={customWeight}
              onChange={setCustomWeight}
            />
            <button
              className="btn btn--primary"
              onClick={addCustom}
              disabled={customWeight === null || customWeight <= 0}
            >
              Add
            </button>
          </div>
        </div>
      </Sheet>
      {dialog}
    </>
  );
}
