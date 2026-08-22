import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Key/value application settings: theme, density, attention weights, model
 * rates. Small, stable, and enough to prove the migration path end to end.
 * The domain tables land in M2 (docs/12).
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});
