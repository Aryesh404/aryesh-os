import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { configureConnection, createDb } from './client.js';
import { ensureSearchIndex } from './search.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../migrations');
const url = process.env['DATABASE_URL'] ?? 'file:./data/aryesh.db';
const authToken = process.env['DATABASE_AUTH_TOKEN'];

const { db, client } = createDb({ url, authToken });
await configureConnection(client, url);
await migrate(db, { migrationsFolder });
await ensureSearchIndex(db);
client.close();

console.warn(`migrated ${url}`);
