import { useInfiniteQuery } from '@tanstack/react-query';

type Cursor = { id: string; updatedAt: number };
export function useRecords<T>(key: readonly unknown[], fetch: (input: { limit: number; cursor?: Cursor }) => Promise<{
  items: T[]; nextCursor: Cursor | null;
}>) {
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as Cursor | undefined,
    queryFn: ({ pageParam }) => fetch({ limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  return { ...query, items: query.data?.pages.flatMap((page) => page.items) ?? [] };
}
