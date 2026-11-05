// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useApi, useApiMutation } from './query.js';
import { saveRecord } from './record-cache.js';

afterEach(cleanup);

describe('saved records without waiting for another read', () => {
  it('shows a newly saved row and finishes saving while the background refresh is still slow', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const refresh = vi.fn(() => new Promise<{ items: { id: string; name: string }[]; nextCursor: null }>(() => {}));
    const row = { id: 'new', name: 'New account' };
    const view = renderHook(() => ({
      query: useApi(['accounts'], refresh, { initialData: { items: [], nextCursor: null } }),
      mutation: useApiMutation(async () => row, {
        record: { key: ['accounts'], insert: true }, invalidates: [['accounts'], ['accounts', 'new']],
      }),
    }), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await act(async () => { await view.result.current.mutation.mutateAsync(undefined); });
    await waitFor(() => expect(view.result.current.query.data?.items).toEqual([row]));
    expect(view.result.current.mutation.isPending).toBe(false);
    expect(view.result.current.query.isFetching).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount(); client.clear();
  });

  it('replaces saved rows in loaded pages without changing cursors or unrelated derived results', () => {
    const client = new QueryClient();
    const before = { id: 'A', title: 'Old', version: 1 };
    const saved = { ...before, title: 'New', version: 2 };
    const cursor = { id: 'A', updatedAt: 123 };
    client.setQueryData(['tasks', 'search', 'Old'], { pages: [{ items: [before], nextCursor: cursor }], pageParams: [undefined] });
    client.setQueryData(['tasks', 'A'], before);
    client.setQueryData(['tasks', 'A', 'explain'], { result: 0.5 });
    saveRecord(client, ['tasks'], saved);
    expect(client.getQueryData(['tasks', 'A'])).toEqual(saved);
    expect(client.getQueryData(['tasks', 'search', 'Old'])).toEqual({ pages: [{ items: [saved], nextCursor: cursor }], pageParams: [undefined] });
    expect(client.getQueryData(['tasks', 'A', 'explain'])).toEqual({ result: 0.5 });
    // A slower, older response must not overwrite a newer completed save.
    saveRecord(client, ['tasks'], before);
    expect(client.getQueryData(['tasks', 'A'])).toEqual(saved);
    client.clear();
  });

  it('does not insert unrelated records into filtered or incomplete lists, or duplicate a saved row', () => {
    const client = new QueryClient();
    const row = { id: 'A', title: 'Task' };
    client.setQueryData(['tasks'], { items: [], nextCursor: null });
    client.setQueryData(['tasks', 'filter'], { items: [], nextCursor: null });
    saveRecord(client, ['tasks'], row, true);
    saveRecord(client, ['tasks'], row, true);
    expect(client.getQueryData(['tasks'])).toEqual({ items: [row], nextCursor: null });
    expect(client.getQueryData(['tasks', 'A'])).toEqual(row);
    expect(client.getQueryData(['tasks', 'filter'])).toEqual({ items: [], nextCursor: null });
    client.setQueryData(['tasks'], { items: [], nextCursor: { id: 'cursor', updatedAt: 1 } });
    saveRecord(client, ['tasks'], row, true);
    expect(client.getQueryData(['tasks'])).toMatchObject({ items: [] });
    client.clear();
  });
});
