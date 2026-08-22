import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../migrations');
const url = process.env['DATABASE_URL'] ?? 'file:./data/aryesh.db';

const { db, client } = createDb({ url });
await migrate(db, { migrationsFolder });
client.close();

console.warn(`migrated ${url}`);
