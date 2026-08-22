import { and, eq, isNull, lte, gte, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { schema } from '@aryesh/db';
import { DAY_MS, type ContributorInput, type GoalInput, type MetricFacts } from '@aryesh/intelligence';
import { NotFoundError } from '@aryesh/domain';

/**
 * Turns database rows into the facts the intelligence core consumes.
 *
 * This is the only place that knows both sides. `packages/intelligence` stays
 * pure by never seeing a row; `packages/db` stays dumb by never computing.
 *
 * The contribution subgraph — `contributes_to` edges — IS the input set. Nothing
 * enters a goal's number through another path (docs/03 §5 rule 1).
 */

const { goals, metrics, readings, projects, tasks, milestones, habits, habitEntries, relations } =
  schema;

export interface BuildOptions {
  now: number;
  /** Trailing window for rate contributors and habit consistency. */
  rateWindowDays?: number;
  /** Guards against a pathological goal tree; cycles are already impossible. */
  maxDepth?: number;
}

interface Ctx extends Required<BuildOptions> {
  db: Db;
  /** Memoised so a diamond in the goal tree is not walked twice. */
  cache: Map<string, GoalInput | null>;
  depth: number;
}

export async function buildGoalInput(
  db: Db,
  goalId: string,
  options: BuildOptions,
): Promise<GoalInput> {
  const ctx: Ctx = {
    db,
    now: options.now,
    rateWindowDays: options.rateWindowDays ?? 90,
    maxDepth: options.maxDepth ?? 8,
    cache: new Map(),
    depth: 0,
  };
  const input = await build(ctx, goalId);
  if (input === null) throw new NotFoundError('goal', goalId);
  return input;
}

async function build(ctx: Ctx, goalId: string): Promise<GoalInput | null> {
  const cached = ctx.cache.get(goalId);
  if (cached !== undefined) return cached;

  const goal = (
    await ctx.db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
      .limit(1)
  )[0];
  if (!goal) {
    ctx.cache.set(goalId, null);
    return null;
  }

  const model = goal.progressModel;

  if (model.mode === 'manual') {
    const input: GoalInput = {
      id: goal.id,
      name: goal.name,
      measurementMode: goal.measurementMode,
      model: { mode: 'manual', value: model.value },
    };
    ctx.cache.set(goalId, input);
    return input;
  }

  if (model.mode === 'metric') {
    const facts = await metricFacts(ctx, model.metricId);
    const input: GoalInput =
      facts === null
        ? {
            id: goal.id,
            name: goal.name,
            measurementMode: goal.measurementMode,
            model: { mode: 'weighted', contributors: [] },
          }
        : {
            id: goal.id,
            name: goal.name,
            measurementMode: goal.measurementMode,
            model: { mode: 'metric', metric: facts, label: facts.key },
          };
    ctx.cache.set(goalId, input);
    return input;
  }

  const edges = await ctx.db
    .select()
    .from(relations)
    .where(
      and(
        eq(relations.toId, goalId),
        eq(relations.kind, 'contributes_to'),
        isNull(relations.deletedAt),
      ),
    );

  const contributors: ContributorInput[] = [];
  for (const edge of edges) {
    const contributor = await resolveEdge(ctx, goal.measurementMode, edge);
    if (contributor !== null) contributors.push(contributor);
  }

  const input: GoalInput = {
    id: goal.id,
    name: goal.name,
    measurementMode: goal.measurementMode,
    model: { mode: 'weighted', contributors },
  };
  ctx.cache.set(goalId, input);
  return input;
}

type Edge = typeof relations.$inferSelect;

/**
 * A momentum goal scores unbounded metrics and habits as rates; everything else
 * is a level. An explicit `evaluation` on the edge always wins.
 */
function evaluationFor(
  mode: 'completion' | 'momentum',
  edge: Edge,
  metricBounded: boolean | null,
): 'level' | 'rate' {
  if (edge.evaluation !== null) return edge.evaluation;
  if (mode !== 'momentum') return 'level';
  if (edge.fromType === 'habit') return 'rate';
  if (edge.fromType === 'metric' && metricBounded === false) return 'rate';
  return 'level';
}

async function resolveEdge(
  ctx: Ctx,
  mode: 'completion' | 'momentum',
  edge: Edge,
): Promise<ContributorInput | null> {
  const weight = edge.weight ?? 1;
  const expectedRate =
    edge.expectedRateValue !== null && edge.expectedRatePer !== null
      ? { value: edge.expectedRateValue, per: edge.expectedRatePer }
      : undefined;

  switch (edge.fromType) {
    case 'metric': {
      const facts = await metricFacts(ctx, edge.fromId);
      if (facts === null) return null;
      const evaluation = evaluationFor(mode, edge, facts.bounded);
      return {
        kind: 'metric',
        refId: edge.fromId,
        label: facts.key,
        weight,
        evaluation,
        ...(expectedRate ? { expectedRate } : {}),
        sources: [`metric:${facts.key}`],
        metric: facts,
        ...(evaluation === 'rate'
          ? { rate: await rateFacts(ctx, edge.fromId) }
          : {}),
      };
    }

    case 'project': {
      const project = (
        await ctx.db
          .select()
          .from(projects)
          .where(and(eq(projects.id, edge.fromId), isNull(projects.deletedAt)))
          .limit(1)
      )[0];
      if (!project) return null;

      const basis = project.progressBasis;
      const facts: ContributorInput = {
        kind: 'project',
        refId: project.id,
        label: project.name,
        weight,
        evaluation: evaluationFor(mode, edge, null),
        sources: [`project:${project.id}`, `tasks:${project.id}`],
        project: await projectFacts(ctx, project.id, basis),
      };
      return facts;
    }

    case 'milestone': {
      const milestone = (
        await ctx.db
          .select()
          .from(milestones)
          .where(and(eq(milestones.id, edge.fromId), isNull(milestones.deletedAt)))
          .limit(1)
      )[0];
      if (!milestone) return null;
      return {
        kind: 'milestone',
        refId: milestone.id,
        label: milestone.name,
        weight,
        evaluation: 'level',
        sources: [`milestones:${milestone.goalId}`],
        // One edge is one milestone. With equal weights this reproduces
        // "achieved ÷ total" exactly, and it shows which one is outstanding.
        milestones: [{ achieved: milestone.achieved, weight: 1 }],
      };
    }

    case 'habit': {
      const habit = (
        await ctx.db
          .select()
          .from(habits)
          .where(and(eq(habits.id, edge.fromId), isNull(habits.deletedAt)))
          .limit(1)
      )[0];
      if (!habit) return null;
      const evaluation = evaluationFor(mode, edge, null);
      const window = ctx.rateWindowDays * DAY_MS;
      const since = ctx.now - window;

      const done = (
        await ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(habitEntries)
          .where(
            and(
              eq(habitEntries.habitId, habit.id),
              eq(habitEntries.completed, true),
              gte(habitEntries.date, since),
            ),
          )
      )[0]?.n ?? 0;

      const expected = expectedOccurrences(habit.cadence, habit.targetPerPeriod, ctx.rateWindowDays);

      if (evaluation === 'rate') {
        return {
          kind: 'metric',
          refId: habit.id,
          label: habit.name,
          weight,
          evaluation: 'rate',
          ...(expectedRate ? { expectedRate } : {}),
          sources: [`habit:${habit.id}`],
          metric: {
            key: habit.name,
            direction: 'increase',
            cadence: habit.cadence,
            bounded: false,
            readingCount: done,
          },
          rate: {
            observed: done,
            windowDays: ctx.rateWindowDays,
            trailingAverage: expected,
          },
        };
      }

      return {
        kind: 'habit',
        refId: habit.id,
        label: habit.name,
        weight,
        evaluation: 'level',
        sources: [`habit:${habit.id}`],
        habit: { completed: done, expected },
      };
    }

    case 'goal': {
      // Only the label is needed here: the sub-goal's progress is resolved by
      // the service, which memoises across the whole tree. Building it here as
      // well would evaluate a shared sub-goal once per parent.
      const sub = (
        await ctx.db
          .select({ name: goals.name })
          .from(goals)
          .where(and(eq(goals.id, edge.fromId), isNull(goals.deletedAt)))
          .limit(1)
      )[0];
      if (!sub) return null;
      return {
        kind: 'goal',
        refId: edge.fromId,
        label: sub.name,
        weight,
        evaluation: 'level',
        sources: [`goal:${edge.fromId}`],
        progress: null,
        confidence: 0,
      };
    }

    default:
      return null;
  }
}

function expectedOccurrences(
  cadence: string,
  targetPerPeriod: number,
  windowDays: number,
): number {
  const perDay =
    cadence === 'daily'
      ? 1
      : cadence === 'weekly'
        ? 1 / 7
        : cadence === 'monthly'
          ? 1 / 30
          : cadence === 'quarterly'
            ? 1 / 91
            : 0;
  return Math.max(0, Math.round(perDay * windowDays * targetPerPeriod));
}

async function metricFacts(ctx: Ctx, metricId: string): Promise<MetricFacts | null> {
  const metric = (
    await ctx.db
      .select()
      .from(metrics)
      .where(and(eq(metrics.id, metricId), isNull(metrics.deletedAt)))
      .limit(1)
  )[0];
  if (!metric) return null;

  const first = (
    await ctx.db
      .select({ value: readings.value, at: readings.at })
      .from(readings)
      .where(eq(readings.metricId, metricId))
      .orderBy(readings.at)
      .limit(1)
  )[0];

  const count =
    (
      await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(readings)
        .where(eq(readings.metricId, metricId))
    )[0]?.n ?? 0;

  return {
    key: metric.key,
    direction: metric.direction,
    cadence: metric.cadence,
    bounded: metric.bounded,
    baseline: metric.baseline ?? undefined,
    target: metric.target ?? undefined,
    tolerance: metric.tolerance ?? undefined,
    currentValue: metric.lastValue ?? undefined,
    firstValue: first?.value,
    firstReadingAt: first?.at,
    lastReadingAt: metric.lastReadingAt ?? undefined,
    readingCount: count,
    manual: metric.source === 'manual',
  };
}

async function rateFacts(ctx: Ctx, metricId: string) {
  const window = ctx.rateWindowDays * DAY_MS;
  const since = ctx.now - window;

  const inWindow = (
    await ctx.db
      .select({ total: sql<number>`coalesce(sum(${readings.value}), 0)` })
      .from(readings)
      .where(and(eq(readings.metricId, metricId), gte(readings.at, since)))
  )[0]?.total ?? 0;

  // The contributor's own trailing average over the preceding window, so
  // "am I holding up against how I have actually been operating?" has an answer.
  const priorTotal = (
    await ctx.db
      .select({ total: sql<number>`coalesce(sum(${readings.value}), 0)` })
      .from(readings)
      .where(
        and(
          eq(readings.metricId, metricId),
          gte(readings.at, since - window),
          lte(readings.at, since),
        ),
      )
  )[0]?.total ?? 0;

  return {
    observed: inWindow,
    windowDays: ctx.rateWindowDays,
    ...(priorTotal > 0 ? { trailingAverage: priorTotal } : {}),
  };
}

async function projectFacts(
  ctx: Ctx,
  projectId: string,
  basis: { mode: string; value?: number; metricId?: string },
) {
  switch (basis.mode) {
    case 'manual':
      return { basis: 'manual' as const, value: basis.value };

    case 'outcome': {
      if (basis.metricId === undefined) return { basis: 'outcome' as const };
      const facts = await metricFacts(ctx, basis.metricId);
      if (facts === null || facts.target === undefined || facts.currentValue === undefined) {
        return { basis: 'outcome' as const };
      }
      const baseline = facts.baseline ?? facts.firstValue ?? 0;
      const range = facts.target - baseline;
      return {
        basis: 'outcome' as const,
        value: range === 0 ? undefined : (facts.currentValue - baseline) / range,
      };
    }

    case 'milestone': {
      const rows = await ctx.db
        .select({ achieved: milestones.achieved, weight: milestones.weight })
        .from(milestones)
        .where(isNull(milestones.deletedAt));
      const total = rows.reduce((s, r) => s + r.weight, 0);
      const achieved = rows.filter((r) => r.achieved).reduce((s, r) => s + r.weight, 0);
      return { basis: 'milestone' as const, achievedWeight: achieved, totalWeight: total };
    }

    default: {
      // Estimate-weighted so a large task counts for more than a trivial one.
      const rows = await ctx.db
        .select({ status: tasks.status, estimate: tasks.estimate })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));

      const effort = (r: { estimate: number | null }) => r.estimate ?? 1;
      const totalEffort = rows.reduce((s, r) => s + effort(r), 0);
      const completedEffort = rows
        .filter((r) => r.status === 'done')
        .reduce((s, r) => s + effort(r), 0);

      return { basis: 'task_based' as const, completedEffort, totalEffort };
    }
  }
}
