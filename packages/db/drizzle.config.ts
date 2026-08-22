import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/db/src/schema/tables/*.ts',
  out: './packages/db/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'file:./data/aryesh.db',
  },
});
