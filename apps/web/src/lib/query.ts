import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { saveRecord } from './record-cache.js';

/**
 * Thin helpers over the vanilla tRPC client rather than the react-query
 * adapter: the app is small, the types already flow through, and one fewer
 * adapter is one fewer thing to keep in step across versions.
 */

export function useApi<T>(
  key: readonly unknown[],
  fn: () => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({ queryKey: key, queryFn: fn, ...options });
}

export function useApiMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  options: {
    /** Query key prefixes to invalidate on success. */
    invalidates?: readonly (readonly unknown[])[];
    /** Apply a saved row before refreshing related data. */
    record?: { key: readonly unknown[]; insert?: boolean };
  } & Omit<UseMutationOptions<TOutput, Error, TInput>, 'mutationFn'> = {},
) {
  const client = useQueryClient();
  const { invalidates = [], record, onSuccess, ...rest } = options;

  return useMutation({
    mutationFn: fn,
    onSuccess: async (...args: Parameters<NonNullable<typeof onSuccess>>) => {
      if (record) {
        // Stop an older read from replacing the row we just saved.
        await client.cancelQueries({ queryKey: record.key });
        saveRecord(client, record.key, args[0], record.insert);
      }
      await onSuccess?.(...args);
      // One matching pass avoids restarting overlapping refreshes (e.g.
      // ['goals'] plus ['goals', id]) after the same save.
      void client.invalidateQueries({ predicate: (query) => invalidates.some((key) =>
        key.every((part, index) => query.queryKey[index] === part)) });
    },
    ...rest,
  });
}

export const keys = {
  today: ['today'] as const,
  auth: ['auth'] as const,
  areas: ['areas'] as const,
  themes: ['themes'] as const,
  goals: ['goals'] as const,
  goal: (id: string) => ['goals', id] as const,
  explain: (id: string) => ['goals', id, 'explain'] as const,
  metrics: ['metrics'] as const,
  readings: (metricId: string) => ['readings', metricId] as const,
  projects: ['projects'] as const,
  tasks: ['tasks'] as const,
  habits: ['habits'] as const,
  milestones: ['milestones'] as const,
  accounts: ['accounts'] as const,
  transactions: ['transactions'] as const,
  categories: ['categories'] as const,
  collectors: ['collectors'] as const,
  needingData: ['readings', 'needingData'] as const,
};
