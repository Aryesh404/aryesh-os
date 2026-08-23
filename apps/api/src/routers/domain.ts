import { z } from 'zod';
import { crudRouter, customFields } from './crud.js';

/**
 * The objects whose whole story is CRUD. Goals, metrics, relations, and
 * progress have real behaviour and get hand-written routers instead.
 */

const timestamp = z.number().int();
const importance = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const cadence = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'adhoc']);
const themeStatus = z.enum(['active', 'paused', 'achieved', 'retired']);

export const areasRouter = crudRouter((repos) => repos.areas, {
  create: z.object({
    name: z.string().min(1).max(120),
    color: z.string().max(32),
    icon: z.string().max(64).optional(),
    targetShare: z.number().min(0).max(1).optional(),
    sortOrder: z.number().int().default(0),
    customFields,
  }),
  update: z.object({
    name: z.string().min(1).max(120).optional(),
    color: z.string().max(32).optional(),
    icon: z.string().max(64).nullable().optional(),
    targetShare: z.number().min(0).max(1).nullable().optional(),
    sortOrder: z.number().int().optional(),
    customFields,
  }),
});

export const themesRouter = crudRouter((repos) => repos.themes, {
  create: z.object({
    areaId: z.string(),
    name: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    why: z.string().max(5000).optional(),
    status: themeStatus.default('active'),
    targetDate: timestamp.optional(),
    importance: importance.default(3),
    sortOrder: z.number().int().default(0),
    customFields,
  }),
  update: z.object({
    areaId: z.string().optional(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    why: z.string().max(5000).nullable().optional(),
    status: themeStatus.optional(),
    targetDate: timestamp.nullable().optional(),
    importance: importance.optional(),
    sortOrder: z.number().int().optional(),
    customFields,
  }),
});

/** docs/03 §4.4 — the basis is explicit, never assumed. */
const progressBasis = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('outcome'), metricId: z.string() }),
  z.object({ mode: z.literal('milestone') }),
  z.object({ mode: z.literal('manual'), value: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('task_based') }),
]);

export const projectsRouter = crudRouter((repos) => repos.projects, {
  create: z.object({
    areaId: z.string().optional(),
    name: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    status: z.string().max(40).default('active'),
    startDate: timestamp.optional(),
    targetDate: timestamp.optional(),
    progressBasis: progressBasis.optional(),
    localPath: z.string().max(500).optional(),
    repoUrl: z.string().url().max(500).optional(),
    techStack: z.array(z.string().max(60)).max(30).optional(),
    customFields,
  }),
  update: z.object({
    areaId: z.string().nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.string().max(40).optional(),
    health: z.string().max(40).nullable().optional(),
    startDate: timestamp.nullable().optional(),
    targetDate: timestamp.nullable().optional(),
    completedAt: timestamp.nullable().optional(),
    progressBasis: progressBasis.optional(),
    localPath: z.string().max(500).nullable().optional(),
    repoUrl: z.string().url().max(500).nullable().optional(),
    techStack: z.array(z.string().max(60)).max(30).nullable().optional(),
    customFields,
  }),
});

/**
 * Tasks emit `task.changed` so their project's cached progress stays true.
 * The event is the seam — the router never calls the progress engine directly.
 */
export const tasksRouter = crudRouter((repos) => repos.tasks, {
  create: z.object({
    projectId: z.string().optional(),
    areaId: z.string().optional(),
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    status: z.string().max(40).default('todo'),
    estimate: z.number().positive().optional(),
    dueDate: timestamp.optional(),
    customFields,
  }),
  update: z.object({
    projectId: z.string().nullable().optional(),
    areaId: z.string().nullable().optional(),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: z.string().max(40).optional(),
    estimate: z.number().positive().nullable().optional(),
    actual: z.number().positive().nullable().optional(),
    dueDate: timestamp.nullable().optional(),
    startedAt: timestamp.nullable().optional(),
    completedAt: timestamp.nullable().optional(),
    customFields,
  }),
}, {
  afterWrite: async (task, ctx) => {
    await ctx.core.events.emit('task.changed', {
      taskId: task.id,
      projectId: task.projectId ?? undefined,
    });
  },
});

export const habitsRouter = crudRouter((repos) => repos.habits, {
  create: z.object({
    areaId: z.string().optional(),
    name: z.string().min(1).max(200),
    cadence,
    targetPerPeriod: z.number().int().min(1).default(1),
    customFields,
  }),
  update: z.object({
    areaId: z.string().nullable().optional(),
    name: z.string().min(1).max(200).optional(),
    cadence: cadence.optional(),
    targetPerPeriod: z.number().int().min(1).optional(),
    customFields,
  }),
});

export const milestonesRouter = crudRouter(
  (repos) => repos.milestones,
  {
    create: z.object({
      goalId: z.string(),
      name: z.string().min(1).max(200),
      dueDate: timestamp.optional(),
      weight: z.number().positive().default(1),
      sortOrder: z.number().int().default(0),
      customFields,
    }),
    update: z.object({
      name: z.string().min(1).max(200).optional(),
      dueDate: timestamp.nullable().optional(),
      achieved: z.boolean().optional(),
      achievedAt: timestamp.nullable().optional(),
      weight: z.number().positive().optional(),
      sortOrder: z.number().int().optional(),
      customFields,
    }),
  },
);

export const accountsRouter = crudRouter((repos) => repos.accounts, {
  create: z.object({
    name: z.string().min(1).max(120),
    kind: z.string().max(40),
    currency: z.string().length(3).default('INR'),
    /** Integer minor units. Never a float. */
    balanceMinor: z.number().int().default(0),
    isLiability: z.boolean().default(false),
    isLiquid: z.boolean().default(true),
    customFields,
  }),
  update: z.object({
    name: z.string().min(1).max(120).optional(),
    kind: z.string().max(40).optional(),
    balanceMinor: z.number().int().optional(),
    isLiability: z.boolean().optional(),
    isLiquid: z.boolean().optional(),
    customFields,
  }),
});

/** docs/08 §1 — user-named categories, statuses, and tags. */
export const categoriesRouter = crudRouter((repos) => repos.categories, {
  create: z.object({
    scope: z.string().min(1).max(60),
    key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(60),
    label: z.string().min(1).max(120),
    color: z.string().max(20).optional(),
    semantics: z.string().max(40).optional(),
    sortOrder: z.number().int().default(0),
    customFields,
  }),
  update: z.object({
    label: z.string().min(1).max(120).optional(),
    color: z.string().max(20).nullable().optional(),
    semantics: z.string().max(40).nullable().optional(),
    sortOrder: z.number().int().optional(),
    customFields,
  }),
});

export const transactionsRouter = crudRouter(
  (repos) => repos.transactions,
  {
    create: z.object({
      accountId: z.string(),
      /** Always positive; `direction` carries the sign. */
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3).default('INR'),
      direction: z.enum(['in', 'out']),
      occurredAt: timestamp,
      description: z.string().max(500).optional(),
      categoryId: z.string().optional(),
      customFields,
    }),
    update: z.object({
      amountMinor: z.number().int().positive().optional(),
      direction: z.enum(['in', 'out']).optional(),
      occurredAt: timestamp.optional(),
      description: z.string().max(500).nullable().optional(),
      categoryId: z.string().nullable().optional(),
      customFields,
    }),
  },
);
