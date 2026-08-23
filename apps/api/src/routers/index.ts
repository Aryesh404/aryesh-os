import { z } from 'zod';
import { search } from '@aryesh/db';
import { AppError, NotMeasurableError } from '@aryesh/contracts';
import { normaliseMetric } from '@aryesh/intelligence';
import {
  actorOf,
  captureProcedure,
  fullProcedure,
  mergeRouters,
  protectedProcedure,
  publicProcedure,
  router,
} from '../trpc.js';
import { authRouter } from './auth.js';
import { parseTransactionCsv, type ParsedTransaction } from './csv.js';
import { dataRouter } from './data.js';
import {
  accountsRouter,
  areasRouter,
  categoriesRouter,
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

/**
 * docs/15 §5 M9 — finance data entry is tedious enough that without an importer
 * it simply does not happen, and a finance goal fed by nothing is worse than no
 * finance goal at all.
 *
 * A **mutation**, not a query, because a query serialises its input into the
 * URL and a year of transactions does not fit there (the M8 lesson).
 */
const transactionsExtras = router({
  importCsv: fullProcedure
    .input(
      z.object({
        accountId: z.string(),
        /** Raw CSV text. Parsed server-side so the rules live in one place. */
        csv: z.string().max(2_000_000),
        currency: z.string().length(3).default('INR'),
        /** Preview without writing. The UI always previews first. */
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = parseTransactionCsv(input.csv);
      if (parsed.errors.length > 0 && parsed.rows.length === 0) {
        throw new AppError('INVALID_INPUT', 'no usable rows in this file', {
          errors: parsed.errors.slice(0, 10),
        });
      }
      if (input.dryRun) {
        return { imported: 0, ...parsed, rows: parsed.rows.slice(0, 20) };
      }

      let imported = 0;
      for (const row of parsed.rows) {
        await ctx.core.repos.transactions.create(
          {
            accountId: input.accountId,
            amountMinor: row.amountMinor,
            currency: input.currency,
            direction: row.direction,
            occurredAt: row.occurredAt,
            ...(row.description === undefined ? {} : { description: row.description }),
          },
          actorOf(ctx),
        );
        imported += 1;
      }

      return { imported, errors: parsed.errors, rows: [] as ParsedTransaction[] };
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

  setExpectedRate: captureProcedure
    .input(
      z.object({
        id: z.string(),
        rate: z
          .object({
            value: z.number().positive(),
            per: z.enum(['week', 'month', 'quarter']),
          })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.core.repos.relations.setExpectedRate(input.id, input.rate, actorOf(ctx));
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
  transactions: mergeRouters(transactionsRouter, transactionsExtras),
  categories: categoriesRouter,

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
