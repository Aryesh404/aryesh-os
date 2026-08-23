import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { configureConnection, createDb } from './client.js';
import { createRepositories, type Repositories } from './repositories/index.js';
import { ensureSearchIndex } from './search.js';
import type { Db } from './client.js';

const migrationsFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

export interface TestDb {
  db: Db;
  repos: Repositories;
  /** Controllable clock — tests never depend on the wall clock. */
  setNow: (ms: number) => void;
  now: () => number;
  close: () => void;
}

/**
 * A real libSQL instance in memory with migrations applied. For a schema this
 * dynamic, mocking the database tests nothing (docs/01 §6).
 */
export async function createTestDb(startAt = 1_700_000_000_000): Promise<TestDb> {
  const { db, client } = createDb({ url: ':memory:' });
  await configureConnection(client, ':memory:');
  await migrate(db, { migrationsFolder });
  await ensureSearchIndex(db);

  let current = startAt;
  const clock = () => current;

  return {
    db,
    repos: createRepositories({ db, clock }),
    setNow: (ms: number) => {
      current = ms;
    },
    now: clock,
    close: () => client.close(),
  };
}

export const TEST_ACTOR = { actor: 'user' as const };
