import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { customFieldsColumn, recordColumns } from './_shared.js';
import { categories } from './config.js';

/**
 * Minimal finance, enough for the collectors that feed metrics (docs/03 §2).
 * Phase 4 adds budgets, investments, and business attribution — finance is a
 * metric source here, not a parallel product (docs/02).
 *
 * Money is always integer minor units plus a currency code. Never a float.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** bank | cash | credit | investment | liability */
    kind: text('kind').notNull(),
    currency: text('currency').notNull().default('INR'),
    balanceMinor: integer('balance_minor').notNull().default(0),
    /** Counts toward net worth as a negative. */
    isLiability: integer('is_liability', { mode: 'boolean' }).notNull().default(false),
    /** Excluded from runway, which only counts what can actually be spent. */
    isLiquid: integer('is_liquid', { mode: 'boolean' }).notNull().default(true),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [index('idx_accounts_kind').on(t.kind).where(sql`deleted_at IS NULL`)],
);

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('INR'),
    /** `in` | `out`. Amount is always positive; direction carries the sign. */
    direction: text('direction').notNull(),
    occurredAt: integer('occurred_at').notNull(),
    description: text('description'),
    categoryId: text('category_id').references(() => categories.id),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_tx_occurred').on(t.occurredAt).where(sql`deleted_at IS NULL`),
    index('idx_tx_account').on(t.accountId, t.occurredAt).where(sql`deleted_at IS NULL`),
    index('idx_tx_direction').on(t.direction, t.occurredAt).where(sql`deleted_at IS NULL`),
  ],
);
