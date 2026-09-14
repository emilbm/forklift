import type {
  AchievableLoads,
  Equipment,
  Exercise,
  LastPerformance,
  LoadPlanResult,
  Plate,
  Regimen,
  Session,
  SessionSummary,
  SetLog,
  SupersetPair,
} from '../../shared/types';

/**
 * Requests are same-origin, so the app works unchanged on a LAN address or
 * behind a tunnel domain — nothing here knows where it is being served from.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server');
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return parsed as T;
}

export interface EquipmentInput {
  name: string;
  kind: Equipment['kind'];
  usesPlates: boolean;
  barWeightKg: number;
  notes: string;
}

export interface ExerciseInput {
  name: string;
  notes: string;
  equipmentIds: number[];
}

export interface RegimenInput {
  name: string;
  notes: string;
  items: Array<{
    exerciseId: number;
    sets: number;
    repsMin: number;
    repsMax: number;
    restSeconds: number;
    notes: string;
  }>;
}

export interface PlateInput {
  weightKg: number;
  count: number;
}

export const api = {
  plates: {
    list: () => request<Plate[]>('GET', '/plates'),
    create: (input: PlateInput) => request<Plate>('POST', '/plates', input),
    update: (id: number, input: PlateInput) => request<Plate>('PUT', `/plates/${id}`, input),
    remove: (id: number) => request<void>('DELETE', `/plates/${id}`),
  },

  equipment: {
    list: () => request<Equipment[]>('GET', '/equipment'),
    create: (input: EquipmentInput) => request<Equipment>('POST', '/equipment', input),
    update: (id: number, input: EquipmentInput) =>
      request<Equipment>('PUT', `/equipment/${id}`, input),
    remove: (id: number) => request<void>('DELETE', `/equipment/${id}`),
    loads: (id: number) => request<AchievableLoads>('GET', `/equipment/${id}/loads`),
  },

  loads: {
    plan: (loads: Array<{ equipmentId: number; targetKg: number }>) =>
      request<LoadPlanResult>('POST', '/loads/plan', { loads }),
  },

  exercises: {
    list: () => request<Exercise[]>('GET', '/exercises'),
    create: (input: ExerciseInput) => request<Exercise>('POST', '/exercises', input),
    update: (id: number, input: ExerciseInput) =>
      request<Exercise>('PUT', `/exercises/${id}`, input),
    remove: (id: number) => request<void>('DELETE', `/exercises/${id}`),
    lastPerformance: (id: number, excludeSessionId?: number) =>
      request<LastPerformance | null>(
        'GET',
        `/exercises/${id}/last-performance${excludeSessionId ? `?exclude=${excludeSessionId}` : ''}`,
      ).catch((err: unknown) => {
        // No history yet is an ordinary state, not an error.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
  },

  regimens: {
    list: () => request<Regimen[]>('GET', '/regimens'),
    get: (id: number) => request<Regimen>('GET', `/regimens/${id}`),
    create: (input: RegimenInput) => request<Regimen>('POST', '/regimens', input),
    update: (id: number, input: RegimenInput) => request<Regimen>('PUT', `/regimens/${id}`, input),
    remove: (id: number) => request<void>('DELETE', `/regimens/${id}`),
    supersetPairs: (id: number) =>
      request<SupersetPair[]>('GET', `/regimens/${id}/superset-pairs`),
  },

  sessions: {
    history: (limit = 30) => request<SessionSummary[]>('GET', `/sessions?limit=${limit}`),
    get: (id: number) => request<Session>('GET', `/sessions/${id}`),
    active: () =>
      request<Session>('GET', '/sessions/active').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }),
    start: (regimenId: number | null) => request<Session>('POST', '/sessions', { regimenId }),
    logSet: (
      sessionId: number,
      input: {
        regimenItemId: number | null;
        exerciseId: number;
        setIndex: number;
        reps: number;
        weightKg: number | null;
      },
    ) => request<SetLog>('POST', `/sessions/${sessionId}/sets`, input),
    removeSet: (sessionId: number, setId: number) =>
      request<void>('DELETE', `/sessions/${sessionId}/sets/${setId}`),
    finish: (sessionId: number, notes?: string) =>
      request<Session>('POST', `/sessions/${sessionId}/finish`, notes ? { notes } : {}),
    remove: (sessionId: number) => request<void>('DELETE', `/sessions/${sessionId}`),
  },
};
