import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type {
  Actor,
  Cadence,
  MetricComponent,
  MetricDirection,
  MetricSource,
  MetricUnit,
} from '@aryesh/domain';
import { customFieldsColumn, recordColumns } from './_shared.js';
import { areas } from './structure.js';

export const metrics = sqliteTable(
  'metrics',
  {
    id: text('id').primaryKey(),
    /** Immutable, referenced by derived-metric expressions. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    areaId: text('area_id').references(() => areas.id),
    unit: text('unit').notNull().$type<MetricUnit>(),
    direction: text('direction').notNull().$type<MetricDirection>(),
    baseline: real('baseline'),
    target: real('target'),
    targetDate: integer('target_date'),
    /** `maintain` only: the acceptable band around target. */
    tolerance: real('tolerance'),
    cadence: text('cadence').notNull().$type<Cadence>(),
    aggregation: text('aggregation').notNull().default('last'),
    source: text('source').notNull().$type<MetricSource>(),
    /** Derived metrics only (docs/03 §3). */
    expression: text('expression'),
    /** Computed metrics only (docs/03 §2). */
    collectorKey: text('collector_key'),
    /** docs/03 §11 — a corpus grows from contributions AND returns. */
    components: text('components', { mode: 'json' }).$type<MetricComponent[]>(),
    /**
     * False for counts with no meaningful target ("projects shipped"). Such a
     * metric is valid only as a rate contributor — normalising it as a level
     * would divide by an undefined target (docs/14 Case 3).
     */
    bounded: integer('bounded', { mode: 'boolean' }).notNull().default(true),
    /** Excluded from AI context. */
    private: integer('private', { mode: 'boolean' }).notNull().default(false),

    // Denormalised hot path, maintained on write.
    lastReadingAt: integer('last_reading_at'),
    lastValue: real('last_value'),

    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    uniqueIndex('idx_metrics_key').on(t.key),
    index('idx_metrics_area').on(t.areaId).where(sql`deleted_at IS NULL`),
    index('idx_metrics_stale').on(t.lastReadingAt).where(sql`deleted_at IS NULL`),
  ],
);

/**
 * Append-only time series — the most important table in the system.
 *
 * Never cascade-deleted and never updated: a correction is a new reading
 * superseding the old, so history stays auditable. Deleting a metric never
 * deletes its readings (docs/02 §4).
 */
export const readings = sqliteTable(
  'readings',
  {
    id: text('id').primaryKey(),
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    at: integer('at').notNull(),
    value: real('value').notNull(),
    /**
     * Empty string for scalar metrics; a component key for decomposed ones
     * (docs/03 §11).
     *
     * NOT NULL with an `''` sentinel rather than nullable, because SQLite
     * treats NULLs as DISTINCT in a UNIQUE index — a nullable column here would
     * silently exempt every scalar metric from the dedupe index below, and
     * collector re-runs would double the history instead of updating it.
     */
    component: text('component').notNull().default(''),
    source: text('source').notNull(),
    note: text('note'),
    actor: text('actor').notNull().$type<Actor>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_readings_metric_at').on(t.metricId, t.at),
    /** Makes collector re-runs and backfill idempotent (docs/12). */
    uniqueIndex('idx_readings_dedupe').on(t.metricId, t.at, t.source, t.component),
  ],
);
