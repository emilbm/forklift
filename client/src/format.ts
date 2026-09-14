import type { Equipment, RegimenItem } from '../../shared/types';

/**
 * Weights are kilos throughout; only the display drops trailing zeroes.
 * Two decimals, because 1.25 kg plates exist and rounding them to 1.3 is a lie.
 */
export function formatWeight(kg: number | null | undefined): string {
  if (kg === null || kg === undefined) return '—';
  return String(Math.round(kg * 100) / 100);
}

export function formatReps(item: Pick<RegimenItem, 'repsMin' | 'repsMax'>): string {
  return item.repsMin === item.repsMax ? String(item.repsMin) : `${item.repsMin}–${item.repsMax}`;
}

export function formatPrescription(item: Pick<RegimenItem, 'sets' | 'repsMin' | 'repsMax'>): string {
  return `${item.sets} × ${formatReps(item)}`;
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(fromIso: string, toIso: string | null): string {
  const end = toIso ? new Date(toIso).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - new Date(fromIso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  if (sameDay(date, today)) return `Today ${time}`;
  if (sameDay(date, yesterday)) return `Yesterday ${time}`;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const EQUIPMENT_KINDS: Array<{ value: Equipment['kind']; label: string }> = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bench', label: 'Bench' },
  { value: 'rack', label: 'Rack' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'other', label: 'Other' },
];

export const kindLabel = (kind: Equipment['kind']): string =>
  EQUIPMENT_KINDS.find((k) => k.value === kind)?.label ?? 'Other';
