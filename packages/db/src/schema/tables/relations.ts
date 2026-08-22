import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { Actor, ObjectKind, RelationKind } from '@aryesh/domain';

/**
 * docs/02 §2 — six fixed relation kinds, of which five are stored.
 *
 * `belongs_to` is never stored: containment is already a foreign key, and a
 * second copy can drift. The graph derives those edges from the FKs.
 *
 * Endpoints are polymorphic, so SQLite cannot enforce them with a foreign key.
 * Validity is enforced in the repository against the static endpoint table in
 * `@aryesh/domain`, with a nightly integrity check that reports (never
 * auto-deletes) orphans. The alternative — a junction table per pair — is
 * dozens of tables for one concept.
 */
export const relations = sqliteTable(
  'relations',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull().$type<RelationKind>(),
    fromType: text('from_type').notNull().$type<ObjectKind>(),
    fromId: text('from_id').notNull(),
    toType: text('to_type').notNull().$type<ObjectKind>(),
    toId: text('to_id').notNull(),
    /** `contributes_to` only. Relative; normalised at evaluation time. */
    weight: real('weight'),
    /**
     * `contributes_to` only. How this contributor is scored (docs/03 §4).
     * Null means derive it: a momentum goal scores unbounded metrics and habits
     * as rates, everything else as levels. Set explicitly to override.
     */
    evaluation: text('evaluation').$type<'level' | 'rate'>(),
    /** Expected cadence for a rate contributor, e.g. 1 per month. */
    expectedRateValue: real('expected_rate_value'),
    expectedRatePer: text('expected_rate_per').$type<'week' | 'month' | 'quarter'>(),
    /** `measures` only (docs/03 §10). User-stated, never inferred. */
    leadsMetricId: text('leads_metric_id'),
    lagDays: integer('lag_days'),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').notNull().$type<Actor>(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    uniqueIndex('idx_relations_unique').on(
      t.kind,
      t.fromType,
      t.fromId,
      t.toType,
      t.toId,
    ),
    // Traversal runs both ways, so both directions are indexed.
    index('idx_rel_from').on(t.fromType, t.fromId, t.kind).where(sql`deleted_at IS NULL`),
    index('idx_rel_to').on(t.toType, t.toId, t.kind).where(sql`deleted_at IS NULL`),
    // Progress roll-up is the hottest read in the product.
    index('idx_rel_contrib')
      .on(t.toId, t.weight)
      .where(sql`kind = 'contributes_to' AND deleted_at IS NULL`),
  ],
);
