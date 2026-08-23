import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

/**
 * Full-text search across the domain.
 *
 * FTS5 is a virtual table, which drizzle-kit cannot express, so it is created
 * here idempotently rather than fought into the schema DSL.
 *
 * The index is maintained by SQLite triggers rather than by application code.
 * Anything that writes a row — a repository, a collector, a future importer —
 * keeps search correct without having to remember to.
 */

interface Searchable {
  table: string;
  kind: string;
  titleColumn: string;
  bodyColumns: string[];
}

const SEARCHABLE: Searchable[] = [
  { table: 'areas', kind: 'area', titleColumn: 'name', bodyColumns: [] },
  { table: 'themes', kind: 'theme', titleColumn: 'name', bodyColumns: ['description', 'why'] },
  { table: 'goals', kind: 'goal', titleColumn: 'name', bodyColumns: ['description', 'why'] },
  { table: 'milestones', kind: 'milestone', titleColumn: 'name', bodyColumns: [] },
  { table: 'metrics', kind: 'metric', titleColumn: 'name', bodyColumns: ['key'] },
  { table: 'projects', kind: 'project', titleColumn: 'name', bodyColumns: ['description'] },
  { table: 'tasks', kind: 'task', titleColumn: 'title', bodyColumns: ['description'] },
  { table: 'habits', kind: 'habit', titleColumn: 'name', bodyColumns: [] },
  {
    table: 'transactions',
    kind: 'transaction',
    titleColumn: 'description',
    bodyColumns: [],
  },
];

const body = (columns: string[], prefix: string): string =>
  columns.length === 0
    ? `''`
    : columns.map((c) => `coalesce(${prefix}.${c}, '')`).join(` || ' ' || `);

export async function ensureSearchIndex(db: Db): Promise<void> {
  await db.run(sql`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      kind UNINDEXED,
      ref_id UNINDEXED,
      title,
      body,
      tokenize = 'porter unicode61'
    )
  `);

  for (const entry of SEARCHABLE) {
    const { table, kind, titleColumn } = entry;
    const newBody = body(entry.bodyColumns, 'new');

    await db.run(
      sql.raw(`
      CREATE TRIGGER IF NOT EXISTS fts_${table}_ai AFTER INSERT ON ${table} BEGIN
        INSERT INTO search_index(kind, ref_id, title, body)
        SELECT '${kind}', new.id, coalesce(new.${titleColumn}, ''), ${newBody}
        WHERE new.deleted_at IS NULL;
      END;
    `),
    );

    // Soft delete has to remove the row from the index: an archived goal that
    // still answered searches would be a small, constant lie.
    await db.run(
      sql.raw(`
      CREATE TRIGGER IF NOT EXISTS fts_${table}_au AFTER UPDATE ON ${table} BEGIN
        DELETE FROM search_index WHERE kind = '${kind}' AND ref_id = old.id;
        INSERT INTO search_index(kind, ref_id, title, body)
        SELECT '${kind}', new.id, coalesce(new.${titleColumn}, ''), ${newBody}
        WHERE new.deleted_at IS NULL;
      END;
    `),
    );

    await db.run(
      sql.raw(`
      CREATE TRIGGER IF NOT EXISTS fts_${table}_ad AFTER DELETE ON ${table} BEGIN
        DELETE FROM search_index WHERE kind = '${kind}' AND ref_id = old.id;
      END;
    `),
    );
  }
}

export interface SearchHit {
  kind: string;
  id: string;
  title: string;
  snippet: string;
  rank: number;
}

/**
 * FTS5 treats several characters as query syntax. A user typing `₹5L MRR` or
 * `budget: 2026` should get results, not a syntax error, so the input is
 * quoted per-token and a prefix match is applied to the last one.
 */
function toMatchQuery(raw: string): string | null {
  const tokens = raw
    .replace(/["*()]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return null;

  return tokens
    .map((token, i) => {
      const quoted = `"${token}"`;
      return i === tokens.length - 1 ? `${quoted}*` : quoted;
    })
    .join(' AND ');
}

export async function search(
  db: Db,
  query: string,
  options: { limit?: number; kinds?: string[] } = {},
): Promise<SearchHit[]> {
  const match = toMatchQuery(query);
  if (match === null) return [];

  const limit = Math.min(options.limit ?? 20, 100);
  const kinds = options.kinds ?? [];

  const rows = await db.all<{
    kind: string;
    ref_id: string;
    title: string;
    snippet: string;
    rank: number;
  }>(sql`
    SELECT kind, ref_id, title,
           snippet(search_index, 3, '[', ']', '…', 12) AS snippet,
           rank
    FROM search_index
    WHERE search_index MATCH ${match}
      ${kinds.length > 0 ? sql`AND kind IN ${kinds}` : sql``}
    ORDER BY rank
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    kind: r.kind,
    id: r.ref_id,
    title: r.title,
    snippet: r.snippet,
    rank: r.rank,
  }));
}

/** Rebuilds from scratch. For recovery, or after a bulk import. */
export async function reindexSearch(db: Db): Promise<number> {
  await db.run(sql`DELETE FROM search_index`);

  let total = 0;
  for (const entry of SEARCHABLE) {
    await db.run(
      sql.raw(`
      INSERT INTO search_index(kind, ref_id, title, body)
      SELECT '${entry.kind}', id, coalesce(${entry.titleColumn}, ''), ${body(entry.bodyColumns, entry.table)}
      FROM ${entry.table}
      WHERE deleted_at IS NULL
    `),
    );
    const [row] = await db.all<{ n: number }>(
      sql.raw(`SELECT count(*) AS n FROM ${entry.table} WHERE deleted_at IS NULL`),
    );
    total += row?.n ?? 0;
  }
  return total;
}
