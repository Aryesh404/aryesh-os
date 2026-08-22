import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  GoalStatus,
  MeasurementMode,
  ProgressModel,
  ProjectionModel,
} from '@aryesh/domain';
import { customFieldsColumn, recordColumns } from './_shared.js';
import { areas, themes } from './structure.js';

export const goals = sqliteTable(
  'goals',
  {
    id: text('id').primaryKey(),
    areaId: text('area_id')
      .notNull()
      .references(() => areas.id),
    themeId: text('theme_id').references(() => themes.id),
    // Self-reference needs the explicit return type or TS cannot infer it.
    parentGoalId: text('parent_goal_id').references((): AnySQLiteColumn => goals.id),
    name: text('name').notNull(),
    description: text('description'),
    /** Why this goal exists. Distinguishes one worth protecting from one worth
     *  abandoning, and is the first thing to surface when it stalls. */
    why: text('why'),
    startDate: integer('start_date'),
    /** Nullable: undated goals are judged on momentum, not pace (docs/04 §3). */
    targetDate: integer('target_date'),
    status: text('status').notNull().$type<GoalStatus>().default('active'),
    importance: integer('importance').notNull().default(3),
    /** docs/03 §4.0 — not everything worth tracking can be a percentage. */
    measurementMode: text('measurement_mode')
      .notNull()
      .$type<MeasurementMode>()
      .default('completion'),
    progressModel: text('progress_model', { mode: 'json' })
      .notNull()
      .$type<ProgressModel>()
      .default({ mode: 'rollup' }),
    /** Null means linear (docs/04 §2). */
    projectionModel: text('projection_model', { mode: 'json' }).$type<ProjectionModel>(),

    // Cached, computed. Never authoritative — recomputed from contributors.
    progress: real('progress'),
    confidence: real('confidence'),
    progressComputedAt: integer('progress_computed_at'),
    /** Set when a contributor is unsatisfied, so the number is never silently
     *  computed a different way (docs/03 §4 aggregation). */
    degradedReason: text('degraded_reason'),

    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_goals_area').on(t.areaId, t.status).where(sql`deleted_at IS NULL`),
    index('idx_goals_theme').on(t.themeId).where(sql`deleted_at IS NULL`),
    index('idx_goals_parent').on(t.parentGoalId).where(sql`deleted_at IS NULL`),
    index('idx_goals_target')
      .on(t.targetDate)
      .where(sql`deleted_at IS NULL AND target_date IS NOT NULL`),
  ],
);

export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id),
    name: text('name').notNull(),
    dueDate: integer('due_date'),
    achieved: integer('achieved', { mode: 'boolean' }).notNull().default(false),
    achievedAt: integer('achieved_at'),
    weight: real('weight').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_milestones_goal')
      .on(t.goalId, t.sortOrder)
      .where(sql`deleted_at IS NULL`),
  ],
);
