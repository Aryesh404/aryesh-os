import { z } from 'zod';
import { search } from '@aryesh/db';
import { NotMeasurableError } from '@aryesh/contracts';
import { normaliseMetric } from '@aryesh/intelligence';
import { actorOf, captureProcedure, fullProcedure, protectedProcedure, publicProcedure, router } from '../trpc.js';
import { authRouter } from './auth.js';
import { dataRouter } from './data.js';
import {
  accountsRouter,
  areasRouter,
  habitsRouter,
  milestonesRouter,
  projectsRouter,
  tasksRouter,
  themesRouter,
  transactionsRouter,
} from './domain.js';
import { goalsRouter } from './goals.js';
import {
  collectorsRouter,
  metricsRouter,
  readingsRouter,
} from './measurement.js';

const health = router({
  ping: publicProcedure.query(({ ctx }) => ({
    ok: true as const,
    at: ctx.now(),
    version: '0.1.0',
  })),
});

/**
 * Kept from M1 as the smallest end-to-end proof that a value can enter the API,
 * be normalised by the pure engine, and come back with its derivation. Its
 * regression test guards the tRPC error-mapping middleware.
 */
const measure = router({
  normalise: publicProcedure
    .input(
      z.object({
        direction: z.enum(['increase', 'decrease', 'maintain']),
        current: z.number().finite(),
        baseline: z.number().finite().optional(),
        target: z.number().finite().optional(),
        tolerance: z.number().finite().positive().optional(),
        label: z.string().max(120).optional(),
      }),
    )
    .query(({ input }) => {
      const result = normaliseMetric(input);
      if (!result.satisfied) {
        throw new NotMeasurableError(result.reason, { input });
      }
      return result.result;
    }),
});

const relations = router({
  create: captureProcedure
    .input(
      z.object({
        kind: z.enum([
          'contributes_to',
          'depends_on',
          'measures',
          'informed_by',
          'relates_to',
        ]),
        fromType: z.enum([
          'area',
          'theme',
          'goal',
          'milestone',
          'metric',
          'project',
          'task',
          'habit',
        ]),
        fromId: z.string(),
        toType: z.enum([
          'area',
          'theme',
          'goal',
          'milestone',
          'metric',
          'project',
          'task',
          'habit',
        ]),
        toId: z.string(),
        weight: z.number().min(0).optional(),
        evaluation: z.enum(['level', 'rate']).optional(),
        expectedRate: z
          .object({
            value: z.number().positive(),
            per: z.enum(['week', 'month', 'quarter']),
          })
          .optional(),
        leads: z
          .object({ targetMetricId: z.string(), lagDays: z.number().int().min(1) })
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => ctx.core.repos.relations.create(input, actorOf(ctx))),

  setWeight: captureProcedure
    .input(z.object({ id: z.string(), weight: z.number().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.core.repos.relations.setWeight(input.id, input.weight, actorOf(ctx));
      return { ok: true as const };
    }),

  remove: fullProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.core.repos.relations.softDelete(input.id, actorOf(ctx));
      return { ok: true as const };
    }),

  touching: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ctx.core.repos.relations.touching(input.id)),

  /** The contribution subgraph — the progress engine's entire input. */
  contributorsOf: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(({ ctx, input }) => ctx.core.repos.relations.contributorsOf(input.goalId)),
});

const snapshots = router({
  run: fullProcedure
    .input(z.object({ at: z.number().int().optional() }))
    .mutation(({ ctx, input }) => ctx.core.snapshots.run(input.at)),
});

export const appRouter = router({
  health,
  measure,
  auth: authRouter,

  areas: areasRouter,
  themes: themesRouter,
  projects: projectsRouter,
  tasks: tasksRouter,
  habits: habitsRouter,
  milestones: milestonesRouter,
  accounts: accountsRouter,
  transactions: transactionsRouter,

  goals: goalsRouter,
  metrics: metricsRouter,
  readings: readingsRouter,
  collectors: collectorsRouter,
  relations,
  snapshots,
  data: dataRouter,

  search: router({
    query: protectedProcedure
      .input(
        z.object({
          q: z.string().max(200),
          limit: z.number().int().min(1).max(100).default(20),
          kinds: z.array(z.string()).max(12).optional(),
        }),
      )
      .query(({ ctx, input }) =>
        search(ctx.db, input.q, {
          limit: input.limit,
          ...(input.kinds ? { kinds: input.kinds } : {}),
        }),
      ),
  }),
});

export type AppRouter = typeof appRouter;
