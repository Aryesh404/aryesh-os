import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { CustomFieldKind, CustomFieldOption } from '@aryesh/domain';
import { recordColumns } from './_shared.js';

/** docs/08 §3 — user-defined annotation on the fixed domain objects. */
export const customFieldDefs = sqliteTable(
  'custom_field_defs',
  {
    id: text('id').primaryKey(),
    objectKind: text('object_kind').notNull(),
    /** Immutable. Renaming changes `label`, never this. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    kind: text('kind').notNull().$type<CustomFieldKind>(),
    required: integer('required', { mode: 'boolean' }).notNull().default(false),
    /** Excluded from AI context. */
    private: integer('private', { mode: 'boolean' }).notNull().default(false),
    defaultValue: text('default_value', { mode: 'json' }),
    options: text('options', { mode: 'json' }).$type<CustomFieldOption[]>(),
    min: integer('min'),
    max: integer('max'),
    /** `currency` only: ISO code. Values are stored in minor units. */
    currency: text('currency'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...recordColumns,
  },
  (t) => [
    uniqueIndex('idx_cfd_key').on(t.objectKind, t.key),
    index('idx_cfd_object').on(t.objectKind).where(sql`deleted_at IS NULL`),
  ],
);

/** User-defined statuses, tags, and transaction categories (docs/08 §1). */
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    /** e.g. `task.status`, `project.status`, `transaction.category`, `tag`. */
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    color: text('color'),
    /** Lets code reason about a user-named status: `open` | `active` | `done`. */
    semantics: text('semantics'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...recordColumns,
  },
  (t) => [
    uniqueIndex('idx_categories_key').on(t.scope, t.key),
    index('idx_categories_scope').on(t.scope).where(sql`deleted_at IS NULL`),
  ],
);
