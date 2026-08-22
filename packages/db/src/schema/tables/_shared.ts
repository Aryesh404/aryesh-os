import { integer, text } from 'drizzle-orm/sqlite-core';

/**
 * Column groups shared by every record. Spread into a table definition.
 *
 * Timestamps are UTC epoch milliseconds stored as integers — formatting happens
 * only at the edge (docs/11 conventions).
 */

/** Who did it. Every mutation carries an actor; there is no anonymous write. */
export const actorColumns = {
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
};

export const timestampColumns = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

/** Optimistic concurrency. Bumped on every update. */
export const versionColumn = {
  version: integer('version').notNull().default(1),
};

/** docs/02 §4 — soft delete everywhere, 30-day restore window. */
export const softDeleteColumn = {
  deletedAt: integer('deleted_at'),
};

export const archiveColumn = {
  archivedAt: integer('archived_at'),
};

/** The full set for a normal domain record. */
export const recordColumns = {
  ...timestampColumns,
  ...actorColumns,
  ...versionColumn,
  ...softDeleteColumn,
};

/** User-defined annotation (docs/08 §3). Never feeds progress computation. */
export const customFieldsColumn = {
  customFields: text('custom_fields', { mode: 'json' })
    .notNull()
    .$type<Record<string, unknown>>()
    .default({}),
};
