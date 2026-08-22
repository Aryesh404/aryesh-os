import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { Cadence, ProjectProgressBasis } from '@aryesh/domain';
import { customFieldsColumn, recordColumns } from './_shared.js';
import { areas } from './structure.js';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    areaId: text('area_id').references(() => areas.id),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    health: text('health'),
    startDate: integer('start_date'),
    targetDate: integer('target_date'),
    completedAt: integer('completed_at'),

    progress: real('progress'),
    /**
     * docs/03 §4.4 — task completion is activity. `task_based` is the default
     * because it needs no configuration, but its confidence is capped at 0.6
     * and it is labelled an activity proxy in the UI.
     */
    progressBasis: text('progress_basis', { mode: 'json' })
      .notNull()
      .$type<ProjectProgressBasis>()
      .default({ mode: 'task_based' }),
    progressConfidence: real('progress_confidence'),

    /** Claude execution hooks (docs/10). Paths may contain spaces. */
    localPath: text('local_path'),
    repoUrl: text('repo_url'),
    techStack: text('tech_stack', { mode: 'json' }).$type<string[]>(),

    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_projects_area').on(t.areaId, t.status).where(sql`deleted_at IS NULL`),
    index('idx_projects_status').on(t.status).where(sql`deleted_at IS NULL`),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id),
    areaId: text('area_id').references(() => areas.id),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('todo'),
    /** Relative effort, used to weight task-based project progress. */
    estimate: real('estimate'),
    actual: real('actual'),
    dueDate: integer('due_date'),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [
    index('idx_tasks_project').on(t.projectId, t.status).where(sql`deleted_at IS NULL`),
    index('idx_tasks_status').on(t.status, t.dueDate).where(sql`deleted_at IS NULL`),
    index('idx_tasks_completed').on(t.completedAt).where(sql`deleted_at IS NULL`),
  ],
);

export const habits = sqliteTable(
  'habits',
  {
    id: text('id').primaryKey(),
    areaId: text('area_id').references(() => areas.id),
    name: text('name').notNull(),
    cadence: text('cadence').notNull().$type<Cadence>(),
    targetPerPeriod: integer('target_per_period').notNull().default(1),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    ...customFieldsColumn,
    ...recordColumns,
  },
  (t) => [index('idx_habits_area').on(t.areaId).where(sql`deleted_at IS NULL`)],
);

export const habitEntries = sqliteTable(
  'habit_entries',
  {
    id: text('id').primaryKey(),
    habitId: text('habit_id')
      .notNull()
      .references(() => habits.id),
    /** Start-of-day UTC epoch ms, so one entry per habit per day. */
    date: integer('date').notNull(),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('idx_habit_entries_unique').on(t.habitId, t.date)],
);
