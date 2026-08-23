import { z } from 'zod';
import { findOverlaps } from '@aryesh/intelligence';
import { crudRouter, customFields } from './crud.js';
import {
  actorOf,
  captureProcedure,
  fullProcedure,
  mergeRouters,
  protectedProcedure,
  router,
} from '../trpc.js';

const timestamp = z.number().int();
const importance = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/** docs/03 §4 — how a goal's number is produced. */
const progressModel = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('manual'), value: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('weighted') }),
  z.object({ mode: z.literal('metric'), metricId: z.string() }),
  z.object({ mode: z.literal('rollup') }),
]);

/** docs/04 §2 — not everything grows in a straight line. */
const projectionModel = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear') }),
  z.object({
    kind: z.literal('compounding'),
    /** A stated assumption, never a hidden default. Shown in the UI. */
    annualRate: z.number().min(-0.5).max(1),
    contribution: z.object({
      amount: z.number().finite(),
      per: z.literal('month'),
    }),
    scenarios: z.array(z.number()).max(5).optional(),
  }),
  z.object({ kind: z.literal('none') }),
]);

const goalsCrud = crudRouter((repos) => repos.goals, {
  create: z.object({
    areaId: z.string(),
    themeId: z.string().optional(),
    parentGoalId: z.string().optional(),
    name: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    why: z.string().max(5000).optional(),
    startDate: timestamp.optional(),
    /** Optional: undated goals are judged on momentum, not pace. */
    targetDate: timestamp.optional(),
    importance: importance.default(3),
    measurementMode: z.enum(['completion', 'momentum']).default('completion'),
    progressModel: progressModel.default({ mode: 'rollup' }),
    projectionModel: projectionModel.optional(),
    customFields,
  }),
  update: z.object({
    areaId: z.string().optional(),
    themeId: z.string().nullable().optional(),
    name: z.string().min(1).max(300).optional(),
    description: z.string().max(5000).nullable().optional(),
    why: z.string().max(5000).nullable().optional(),
    startDate: timestamp.nullable().optional(),
    targetDate: timestamp.nullable().optional(),
    status: z.enum(['active', 'achieved', 'missed', 'abandoned', 'paused']).optional(),
    importance: importance.optional(),
    measurementMode: z.enum(['completion', 'momentum']).optional(),
    progressModel: progressModel.optional(),
    projectionModel: projectionModel.nullable().optional(),
    customFields,
  }),
});

const goalsExtras = router({
  /** Reparenting is guarded by the same acyclicity check as contributions. */
  setParent: fullProcedure
    .input(z.object({ id: z.string(), parentGoalId: z.string().nullable() }))
    .mutation(({ ctx, input }) =>
      ctx.core.repos.goals.setParent(input.id, input.parentGoalId, actorOf(ctx)),
    ),

  children: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ctx.core.repos.goals.childrenOf(input.id)),

  inTheme: protectedProcedure
    .input(z.object({ themeId: z.string() }))
    .query(({ ctx, input }) => ctx.core.repos.goals.inTheme(input.themeId)),

  /**
   * The full derivation behind a goal's number — the same structure the UI
   * drill-down renders and Claude receives as context (docs/01 §5).
   */
  explain: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => ctx.core.progress.compute(input.id, { now: ctx.now() })),

  /** Recomputes and caches. Cheap; the graph walk is bounded. */
  recompute: captureProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.core.progress.computeAndCache(input.id, { now: ctx.now() }),
    ),

  /**
   * docs/03 §5 rule 5 — two contributors reading the same events report
   * roughly double the truth while looking entirely legitimate. Checked
   * against the facts the engine actually consumes.
   */
  checkOverlaps: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const built = await ctx.core.progress.inputsFor(input.id, { now: ctx.now() });
      const contributors =
        built.model.mode === 'weighted' || built.model.mode === 'rollup'
          ? built.model.contributors
          : [];
      return findOverlaps(contributors);
    }),

  /** The snapshot series behind a trajectory chart. One indexed range scan. */
  history: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        from: timestamp.optional(),
        to: timestamp.optional(),
        limit: z.number().int().min(1).max(2000).default(400),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.core.snapshots.history(input.id, {
        ...(input.from === undefined ? {} : { from: input.from }),
        ...(input.to === undefined ? {} : { to: input.to }),
        limit: input.limit,
      }),
    ),
});

export const goalsRouter = mergeRouters(goalsCrud, goalsExtras);
