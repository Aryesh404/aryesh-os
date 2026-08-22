import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Actor } from '@aryesh/domain';

/**
 * docs/01 §2 R3 — nothing is destroyed silently, and every AI-caused change is
 * attributable. Every mutation writes one of these.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    at: integer('at').notNull(),
    actor: text('actor').notNull().$type<Actor>(),
    /** `create` | `update` | `delete` | `restore` | domain-specific verbs. */
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    before: text('before', { mode: 'json' }),
    after: text('after', { mode: 'json' }),
    note: text('note'),
    /** Set when the change came from a Claude execution (docs/10). */
    executionId: text('execution_id'),
  },
  (t) => [
    index('idx_audit_subject').on(t.subjectType, t.subjectId, t.at),
    index('idx_audit_at').on(t.at),
    index('idx_audit_actor').on(t.actor, t.at),
  ],
);

/**
 * docs/08 §5 — config changes are versioned with an inverse patch, so undo is a
 * lookup rather than a reconstruction.
 */
export const revisions = sqliteTable(
  'revisions',
  {
    id: text('id').primaryKey(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    version: integer('version').notNull(),
    /** Forward patch: the fields that changed, with their new values. */
    patch: text('patch', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** The same fields with their previous values. Applying this undoes it. */
    inverse: text('inverse', { mode: 'json' })
      .notNull()
      .$type<Record<string, unknown>>(),
    actor: text('actor').notNull().$type<Actor>(),
    at: integer('at').notNull(),
    label: text('label'),
  },
  (t) => [index('idx_revisions_subject').on(t.subjectType, t.subjectId, t.version)],
);
