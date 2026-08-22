import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema/index.js';

export type Db = LibSQLDatabase<typeof schema>;

export interface DbOptions {
  /** File URL such as `file:./data/aryesh.db`, or `:memory:` for tests. */
  url: string;
  /**
   * Base for relative `file:` URLs. Defaults to the process cwd, which is wrong
   * for anything launched from a workspace directory — the API passes the repo
   * root so `npm run dev` and a direct `tsx` run open the same database.
   */
  root?: string;
  authToken?: string;
}

/**
 * Turns `file:./data/aryesh.db` into an absolute file URL. Left alone:
 * `:memory:`, absolute paths, and remote (`libsql://`, `http`) URLs.
 */
export function resolveDbUrl(url: string, root: string = process.cwd()): string {
  if (!url.startsWith('file:')) return url;
  const path = url.slice('file:'.length);
  if (path === '' || path === ':memory:') return url;
  if (isAbsolute(path)) return url;
  return pathToFileURL(resolve(root, path)).href;
}

let client: Client | undefined;

export function createDb(options: DbOptions): { db: Db; client: Client } {
  const url = resolveDbUrl(options.url, options.root);
  const c = createClient(
    options.authToken === undefined ? { url } : { url, authToken: options.authToken },
  );
  return { db: drizzle(c, { schema }), client: c };
}

/**
 * Process-wide database for the API. Tests build their own in-memory instance
 * with `createDb({ url: ':memory:' })` rather than touching this.
 */
export function getDb(options: DbOptions): Db {
  const created = createDb(options);
  client = created.client;
  return created.db;
}

export async function closeDb(): Promise<void> {
  client?.close();
  client = undefined;
}
