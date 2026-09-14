import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, type EquipmentInput, type ExerciseInput, type RegimenInput } from './api';

export const keys = {
  platePools: ['plate-pools'] as const,
  equipment: ['equipment'] as const,
  exercises: ['exercises'] as const,
  regimens: ['regimens'] as const,
  regimen: (id: number) => ['regimens', id] as const,
  supersetPairs: (id: number) => ['regimens', id, 'superset-pairs'] as const,
  // Namespaced so a session id can never be mistaken for a history limit.
  sessions: ['sessions'] as const,
  sessionHistory: (limit: number) => ['sessions', 'history', limit] as const,
  session: (id: number) => ['sessions', 'detail', id] as const,
  activeSession: ['sessions', 'active'] as const,
  lastPerformance: (exerciseId: number, excludeSessionId?: number) =>
    ['exercises', exerciseId, 'last-performance', excludeSessionId ?? null] as const,
};

/* ------------------------------------------------------------ plate pools */

export const usePlatePools = () => useQuery({ queryKey: keys.platePools, queryFn: api.platePools.list });

export function usePlatePoolMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.platePools });
    void qc.invalidateQueries({ queryKey: keys.equipment });
  };
  return {
    create: useMutation({ mutationFn: api.platePools.create, onSuccess: done }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: number; name: string }) => api.platePools.update(id, name),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: api.platePools.remove, onSuccess: done }),
  };
}

/* -------------------------------------------------------------- equipment */

export const useEquipment = () => useQuery({ queryKey: keys.equipment, queryFn: api.equipment.list });

export function useEquipmentMutations() {
  const qc = useQueryClient();
  // Exercises embed equipment, and regimens are read through exercises.
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.equipment });
    void qc.invalidateQueries({ queryKey: keys.exercises });
    void qc.invalidateQueries({ queryKey: keys.regimens });
  };
  return {
    create: useMutation({ mutationFn: api.equipment.create, onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: EquipmentInput }) =>
        api.equipment.update(id, input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: api.equipment.remove, onSuccess: done }),
  };
}

/* -------------------------------------------------------------- exercises */

export const useExercises = () => useQuery({ queryKey: keys.exercises, queryFn: api.exercises.list });

export function useExerciseMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: keys.exercises });
    void qc.invalidateQueries({ queryKey: keys.regimens });
  };
  return {
    create: useMutation({ mutationFn: api.exercises.create, onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: ExerciseInput }) =>
        api.exercises.update(id, input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: api.exercises.remove, onSuccess: done }),
  };
}

/* --------------------------------------------------------------- regimens */

export const useRegimens = () => useQuery({ queryKey: keys.regimens, queryFn: api.regimens.list });

export const useRegimen = (id: number | null) =>
  useQuery({
    queryKey: keys.regimen(id ?? 0),
    queryFn: () => api.regimens.get(id!),
    enabled: id !== null,
  });

export const useSupersetPairs = (id: number | null) =>
  useQuery({
    queryKey: keys.supersetPairs(id ?? 0),
    queryFn: () => api.regimens.supersetPairs(id!),
    enabled: id !== null,
  });

export function useRegimenMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: keys.regimens });
  return {
    create: useMutation({ mutationFn: api.regimens.create, onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: number; input: RegimenInput }) =>
        api.regimens.update(id, input),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: api.regimens.remove, onSuccess: done }),
  };
}

/* --------------------------------------------------------------- sessions */

export const useSessionHistory = (limit = 30) =>
  useQuery({ queryKey: keys.sessionHistory(limit), queryFn: () => api.sessions.history(limit) });

export const useActiveSession = () =>
  useQuery({ queryKey: keys.activeSession, queryFn: api.sessions.active });

export const useSession = (id: number | null) =>
  useQuery({
    queryKey: keys.session(id ?? 0),
    queryFn: () => api.sessions.get(id!),
    enabled: id !== null,
  });

export const useLastPerformance = (exerciseId: number | null, excludeSessionId?: number) =>
  useQuery({
    queryKey: keys.lastPerformance(exerciseId ?? 0, excludeSessionId),
    queryFn: () => api.exercises.lastPerformance(exerciseId!, excludeSessionId),
    enabled: exerciseId !== null,
    staleTime: 5 * 60 * 1000,
  });

/** Session writes touch the session itself, the active-session probe and history. */
export function invalidateSessions(qc: QueryClient, sessionId?: number): void {
  if (sessionId !== undefined) void qc.invalidateQueries({ queryKey: keys.session(sessionId) });
  void qc.invalidateQueries({ queryKey: keys.activeSession });
  void qc.invalidateQueries({ queryKey: keys.sessions });
}
