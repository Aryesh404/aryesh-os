import { z } from 'zod';
import { NotMeasurableError } from '@aryesh/contracts';
import {
  findExpressionCycle,
  findOverlaps,
  normaliseMetric,
  validateExpression,
} from '@aryesh/intelligence';
import { crudRouter, customFields, listInput } from './crud.js';
import {
  actorOf,
  captureProcedure,
  fullProcedure,
  mergeRouters,
  protectedProcedure,
  router,
} from '../trpc.js';

const timestamp = z.number().int();

const metricCore = {
  name: z.string().min(1).max(200),
  areaId: z.string().optional(),
  unit: z.enum(['currency', 'count', 'percent', 'duration', 'score', 'ratio', 'weight', 'custom']),
  direction: z.enum(['increase', 'decrease', 'maintain']),
  baseline: z.number().finite().optional(),
  target: z.number().finite().optional(),
  targetDate: timestamp.optional(),
  tolerance: z.number().finite().positive().optional(),
  cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'adhoc']),
  aggregation: z.enum(['last', 'sum', 'mean', 'max', 'min']).default('last'),
  source: z.enum(['manual', 'derived', 'computed', 'external']),
  expression: z.string().max(2000).optional(),
  collectorKey: z.string().max(120).optional(),
  components: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        label: z.string().min(1).max(120),
        controllable: z.boolean(),
      }),
    )
    .optional(),
  /** False for counts with no meaningful target — rate contributors only. */
  bounded: z.boolean().default(true),
  private: z.boolean().default(false),
  customFields,
};

const metricsCrud = crudRouter((repos) => repos.metrics, {
  create: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/).max(63), ...metricCore }),
  update: z.object({
    name: metricCore.name.optional(),
    areaId: z.string().nullable().optional(),
    baseline: z.number().finite().nullable().optional(),
    target: z.number().finite().nullable().optional(),
    targetDate: timestamp.nullable().optional(),
    tolerance: z.number().finite().positive().nullable().optional(),
    cadence: metricCore.cadence.optional(),
    aggregation: metricCore.aggregation.optional(),
    expression: z.string().max(2000).nullable().optional(),
    bounded: z.boolean().optional(),
    private: z.boolean().optional(),
    customFields,
  }),
});

const metricsExtras = router({
  /**
   * Save-time validation for a derived metric. Errors are values here too: the
   * caller gets a reason and a position, not an exception (docs/03 §3).
   */
  validateExpression: protectedProcedure
    .input(z.object({ expression: z.string().max(2000), key: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const parsed = validateExpression(input.expression);
      if (!parsed.valid) return parsed;

      if (input.key !== undefined) {
        const existing = (await ctx.core.repos.metrics.list({ limit: 500 })) as Array<{
          key: string;
          expression: string | null;
        }>;
        const cycle = findExpressionCycle(
          existing
            .filter((m) => m.expression !== null)
            .map((m) => ({ key: m.key, expression: m.expression as string })),
          { key: input.key, expression: input.expression },
        );
        if (cycle) {
          return {
            valid: false as const,
            error: `this would depend on itself: ${cycle.join(' → ')}`,
          };
        }
      }

      return { valid: true as const, dependsOn: parsed.dependsOn };
    }),

  /** Stateless helper the UI uses to preview a normalisation while editing. */
  preview: protectedProcedure
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
      if (!result.satisfied) throw new NotMeasurableError(result.reason, { input });
      return result.result;
    }),
});

export const metricsRouter = mergeRouters(metricsCrud, metricsExtras);

export const readingsRouter = router({
  /** Capture scope: this is exactly what a phone is for. */
  record: captureProcedure
    .input(
      z.object({
        metricId: z.string(),
        at: timestamp,
        value: z.number().finite(),
        component: z.string().max(60).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const reading = await ctx.core.repos.readings.record(
        {
          metricId: input.metricId,
          at: input.at,
          value: input.value,
          source: 'manual',
          ...(input.component === undefined ? {} : { component: input.component }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
        actorOf(ctx),
      );
      // Moves every goal above this metric, and nothing else (docs/03 §9).
      await ctx.core.events.emit('reading.recorded', {
        metricId: input.metricId,
        at: input.at,
        value: input.value,
      });
      return reading;
    }),

  series: protectedProcedure
    .input(
      z.object({
        metricId: z.string(),
        from: timestamp.optional(),
        to: timestamp.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.core.repos.readings.series(input.metricId, input.from, input.to),
    ),

  latest: protectedProcedure
    .input(z.object({ metricId: z.string(), component: z.string().optional() }))
    .query(({ ctx, input }) =>
      ctx.core.repos.readings.latest(input.metricId, input.component),
    ),

  /** Metrics that have stopped being fed — the most useful nag in the system. */
  needingData: protectedProcedure.input(listInput.partial()).query(async ({ ctx }) => {
    const metrics = (await ctx.core.repos.metrics.list({ limit: 500 })) as Array<{
      id: string;
      key: string;
      name: string;
      cadence: string;
      lastReadingAt: number | null;
    }>;
    const now = ctx.now();
    const periodFor: Record<string, number> = {
      daily: 86_400_000,
      weekly: 604_800_000,
      monthly: 2_592_000_000,
      quarterly: 7_862_400_000,
    };

    return metrics
      .filter((m) => {
        const period = periodFor[m.cadence];
        if (period === undefined) return false;
        if (m.lastReadingAt === null) return true;
        return now - m.lastReadingAt > 2 * period;
      })
      .map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        cadence: m.cadence,
        lastReadingAt: m.lastReadingAt,
        daysSince:
          m.lastReadingAt === null
            ? null
            : Math.floor((now - m.lastReadingAt) / 86_400_000),
      }));
  }),
});

export const collectorsRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.core.collectors.list().map((c) => ({
      key: c.key,
      name: c.name,
      unit: c.unit,
      cadence: c.cadence,
    })),
  ),

  /** Rebuilds history from data that already exists (docs/12 day-one problem). */
  backfill: fullProcedure
    .input(z.object({ months: z.number().int().min(1).max(120).default(12) }))
    .mutation(({ ctx, input }) => ctx.core.collectors.backfill(input.months, ctx.now())),
});

export const overlapRouter = router({
  /**
   * docs/03 §5 rule 5 — checked when a model is saved, because two contributors
   * reading the same events report roughly double the truth while looking
   * entirely legitimate.
   *
   * Runs against the contributor facts the engine actually consumes, not a
   * reconstruction of them.
   */
  check: protectedProcedure
    .input(z.object({ goalId: z.string() }))
    .query(async ({ ctx, input }) => {
      const built = await ctx.core.progress.inputsFor(input.goalId, { now: ctx.now() });
      const contributors =
        built.model.mode === 'weighted' || built.model.mode === 'rollup'
          ? built.model.contributors
          : [];
      return findOverlaps(contributors);
    }),
});
