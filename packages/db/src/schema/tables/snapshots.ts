import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { MeasurementMode } from '@aryesh/domain';
import { goals } from './goals.js';
import { metrics } from './metrics.js';

/** One contributor's share of a goal's progress, frozen at snapshot time. */
export interface SnapshotBreakdownEntry {
  kind: string;
  refId: string;
  label: string;
  weight: number;
  value: number;
}

/**
 * docs/03 §7 — snapshots are what make trajectory possible, and they cannot be
 * reconstructed after the fact: a goal whose model changed last month cannot
 * have last month's progress recomputed honestly. So they start being written
 * before anything displays them.
 */
export const goalSnapshots = sqliteTable(
  'goal_snapshots',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id),
    /** Start-of-day UTC epoch ms. One snapshot per goal per day. */
    date: integer('date').notNull(),
    mode: text('mode').notNull().$type<MeasurementMode>(),
    /** Completion goals only. Null for momentum goals, which have no percentage. */
    progress: real('progress'),
    /** Momentum goals only. 0..1.5, where >1 means exceeding. */
    momentum: real('momentum'),
    confidence: real('confidence').notNull(),
    /** Null when the whole model reported. */
    degradedReason: text('degraded_reason'),
    breakdown: text('breakdown', { mode: 'json' })
      .notNull()
      .$type<SnapshotBreakdownEntry[]>(),
    /** Filled by the trajectory engine once there is enough history. */
    velocity7d: real('velocity_7d'),
    velocity30d: real('velocity_30d'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_goal_snapshots_unique').on(t.goalId, t.date),
    index('idx_goal_snapshots_series').on(t.goalId, t.date),
  ],
);

/** Period rollups, so a two-year chart is a range scan rather than a reduction. */
export const metricSnapshots = sqliteTable(
  'metric_snapshots',
  {
    metricId: text('metric_id')
      .notNull()
      .references(() => metrics.id),
    /** daily | weekly | monthly | quarterly */
    period: text('period').notNull(),
    periodStart: integer('period_start').notNull(),
    value: real('value').notNull(),
    readingCount: integer('reading_count').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.metricId, t.period, t.periodStart] })],
);
