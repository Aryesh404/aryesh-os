import type { QueryClient, QueryKey } from '@tanstack/react-query';

type Row = { id: string; version?: number };
type Page = { items: Row[]; nextCursor?: unknown };
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string';
const isPage = (value: unknown): value is Page => !!value && typeof value === 'object' && 'items' in value && Array.isArray(value.items);

/** Use the saved row immediately; keep server filtering/pagination authoritative. */
export function saveRecord(client: QueryClient, key: QueryKey, value: unknown, insert = false) {
  if (!isRow(value)) return;
  const replace = (old: Row) => typeof old.version === 'number' && typeof value.version === 'number' &&
    old.version > value.version ? old : value;
  for (const query of client.getQueryCache().findAll({ queryKey: key })) {
    const rootList = query.queryKey.length === key.length;
    const updatePage = (page: Page) => {
      const found = page.items.some((row) => row.id === value.id);
      if (found) return { ...page, items: page.items.map((row) => row.id === value.id ? replace(row) : row) };
      // Do not insert into searched, filtered, or incomplete pages.
      return insert && rootList && page.nextCursor === null ? { ...page, items: [...page.items, value] } : page;
    };
    client.setQueryData(query.queryKey, (old: unknown) => {
      if (isRow(old) && old.id === value.id) return replace(old);
      if (isPage(old)) return updatePage(old);
      if (old && typeof old === 'object' && 'pages' in old && Array.isArray(old.pages)) {
        return { ...old, pages: old.pages.map((page: unknown) => isPage(page) ? updatePage(page) : page) };
      }
      return old;
    });
  }
  // A newly created goal can open its detail immediately, without a second read.
  client.setQueryData([...key, value.id], (old: unknown) => isRow(old) ? replace(old) : value);
}
