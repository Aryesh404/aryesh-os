import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';

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
  } & Omit<UseMutationOptions<TOutput, Error, TInput>, 'mutationFn'> = {},
) {
  const client = useQueryClient();
  const { invalidates = [], onSuccess, ...rest } = options;

  return useMutation({
    mutationFn: fn,
    onSuccess: (...args: Parameters<NonNullable<typeof onSuccess>>) => {
      for (const key of invalidates) {
        void client.invalidateQueries({ queryKey: key });
      }
      onSuccess?.(...args);
    },
    ...rest,
  });
}

export const keys = {
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
