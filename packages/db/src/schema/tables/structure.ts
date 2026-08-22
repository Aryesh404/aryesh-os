import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ThemeStatus } from '@aryesh/domain';
import { customFieldsColumn, recordColumns } from './_shared.js';

/** docs/02 §1 — the user's own top-level life structure. */
export const areas = sqliteTable(
  'areas',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    icon: text('icon'),
    /** Intended share of attention, 0..1 (docs/04 §4). */
    targetShare: real('target_share'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [index('idx_areas_order').on(t.sortOrder).where(sql`deleted_at IS NULL`)],
);

/**
 * docs/02 §1 — a named strand of intent, not a calendar bucket. Replaces the
 * fixed life/year/quarter/month/week horizon ladder.
 */
export const themes = sqliteTable(
  'themes',
  {
    id: text('id').primaryKey(),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    name: text('name').notNull(),
    description: text('description'),
    why: text('why'),
    status: text('status').notNull().$type<ThemeStatus>().default('active'),
    /** Optional. Many themes never have one, and that is the point. */
    targetDate: integer('target_date'),
    importance: integer('importance').notNull().default(3),
    /** Cached, rolled up from the theme's goals. */
    progress: real('progress'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_themes_area').on(t.areaId, t.status).where(sql`deleted_at IS NULL`),
  ],
);
