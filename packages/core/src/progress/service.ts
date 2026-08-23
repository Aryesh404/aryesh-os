import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { schema } from '@aryesh/db';
import {
  computeProgress,
  type ContributorInput,
  type GoalInput,
  type ProgressOutcome,
} from '@aryesh/intelligence';
import { buildGoalInput, type BuildOptions } from './build-input.js';
import type { EventBus } from '../events/bus.js';

const { goals, projects, relations, tasks } = schema;

export interface ProgressServiceDeps {
  db: Db;
  clock: () => number;
  events?: EventBus;
}

export interface GoalProgress {
  goalId: string;
  outcome: ProgressOutcome;
}

/**
 * Composes storage with the pure engine: resolve the facts, compute, cache.
 *
 * Sub-goals are computed depth-first and memoised, so a diamond in the goal
 * tree costs one evaluation rather than two. Cycles cannot occur — they are
 * rejected at relation creation (docs/02 §8).
 */
export function createProgressService({ db, clock, events }: ProgressServiceDeps) {
  const service = {
    async compute(goalId: string, options?: Partial<BuildOptions>): Promise<ProgressOutcome> {
      const now = options?.now ?? clock();
      const memo = new Map<string, ProgressOutcome>();
      return computeRecursive(db, goalId, { ...options, now }, memo);
    },

    /**
     * Computes and writes the cached figures onto the goal row. The cache is
     * never authoritative; it exists so a dashboard read is not a graph walk.
     */
    async computeAndCache(
      goalId: string,
      options?: Partial<BuildOptions>,
    ): Promise<ProgressOutcome> {
      const now = options?.now ?? clock();
      const outcome = await service.compute(goalId, { ...options, now });

      const progress =
        outcome.measurable && outcome.mode === 'completion' ? outcome.progress.value : null;
      const confidence = outcome.measurable
        ? outcome.mode === 'completion'
          ? outcome.progress.confidence
          : outcome.momentum.confidence
        : 0;
      const degradedReason = outcome.measurable
        ? (outcome.degraded?.reason ?? null)
        : outcome.reason;

      await db
        .update(goals)
        .set({ progress, confidence, progressComputedAt: now, degradedReason })
        .where(eq(goals.id, goalId));

      await events?.emit('progress.recomputed', { goalId, progress, confidence });
      return outcome;
    },

    /**
     * Walks *up* the contribution graph invalidating ancestors, then recomputes
     * them. No full-graph recomputation, ever (docs/03 §9).
     */
    async recomputeAffectedBy(
      seed: { kind: string; id: string },
      options?: Partial<BuildOptions>,
    ): Promise<string[]> {
      const now = options?.now ?? clock();
      const affected = await ancestorGoals(db, seed);
      for (const goalId of affected) {
        await service.computeAndCache(goalId, { ...options, now });
      }
      return affected;
    },

    /**
     * Projects cache their progress the same way goals do, so a list view is a
     * read rather than a fan-out of task queries. The basis is whatever the
     * project declares; `task_based` stays an activity proxy either way
     * (docs/03 §4.4).
     */
    async recomputeProject(projectId: string): Promise<number | null> {
      const project = (
        await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
      )[0];
      if (!project) return null;

      const basis = project.progressBasis;
      let value: number | null = null;
      let confidence: number | null = null;

      if (basis.mode === 'manual') {
        value = basis.value;
        confidence = 0.7;
      } else if (basis.mode === 'task_based') {
        const rows = await db
          .select({ status: tasks.status, estimate: tasks.estimate })
          .from(tasks)
          .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));

        const effort = (r: { estimate: number | null }): number => r.estimate ?? 1;
        const total = rows.reduce((sum, r) => sum + effort(r), 0);
        if (total > 0) {
          const done = rows
            .filter((r) => r.status === 'done')
            .reduce((sum, r) => sum + effort(r), 0);
          value = done / total;
          // Capped, because counting closed tasks measures motion, not distance.
          confidence = 0.6;
        }
      }

      await db
        .update(projects)
        .set({ progress: value, progressConfidence: confidence })
        .where(eq(projects.id, projectId));

      return value;
    },

    /**
     * The resolved contributor facts for a goal, as the engine sees them.
     * Exposed so overlap detection runs against what actually feeds the
     * number rather than a reconstruction of it.
     */
    async inputsFor(goalId: string, options?: Partial<BuildOptions>): Promise<GoalInput> {
      return buildGoalInput(db, goalId, { ...options, now: options?.now ?? clock() });
    },

    async allActiveGoalIds(): Promise<string[]> {
      const rows = await db
        .select({ id: goals.id })
        .from(goals)
        .where(isNull(goals.deletedAt));
      return rows.map((r) => r.id);
    },
  };

  return service;
}

export type ProgressService = ReturnType<typeof createProgressService>;

async function computeRecursive(
  db: Db,
  goalId: string,
  options: BuildOptions,
  memo: Map<string, ProgressOutcome>,
): Promise<ProgressOutcome> {
  const cached = memo.get(goalId);
  if (cached) return cached;

  // Placeholder guards against re-entry while this goal is still resolving.
  memo.set(goalId, { measurable: false, mode: 'completion', reason: 'resolving' });

  const input = await buildGoalInput(db, goalId, options);
  const resolved = await resolveSubGoals(db, input, options, memo);
  const outcome = computeProgress(resolved, { now: options.now });

  memo.set(goalId, outcome);
  return outcome;
}

async function resolveSubGoals(
  db: Db,
  input: GoalInput,
  options: BuildOptions,
  memo: Map<string, ProgressOutcome>,
): Promise<GoalInput> {
  if (input.model.mode !== 'weighted' && input.model.mode !== 'rollup') return input;

  const contributors: ContributorInput[] = [];
  for (const c of input.model.contributors) {
    if (c.kind !== 'goal') {
      contributors.push(c);
      continue;
    }

    const sub = await computeRecursive(db, c.refId, options, memo);
    // A momentum sub-goal has no percentage to roll up into a completion
    // parent; it stays unsatisfied and the parent degrades with a reason
    // rather than inventing a number for it.
    const progress =
      sub.measurable && sub.mode === 'completion' ? sub.progress.value : null;
    const confidence = sub.measurable
      ? sub.mode === 'completion'
        ? sub.progress.confidence
        : sub.momentum.confidence
      : 0;

    contributors.push({ ...c, progress, confidence });
  }

  return { ...input, model: { mode: input.model.mode, contributors } };
}

/** Every goal whose number depends on this node, including itself if it is one. */
async function ancestorGoals(db: Db, seed: { kind: string; id: string }): Promise<string[]> {
  const found = new Set<string>();
  if (seed.kind === 'goal') found.add(seed.id);

  // `mode: 'metric'` is a shorthand that names its metric in the progress model
  // rather than through a contributes_to edge, so the edge walk below cannot
  // see it. Without this, a reading would update the metric and quietly leave
  // the goal's cached number stale.
  if (seed.kind === 'metric') {
    const direct = await db
      .select({ id: goals.id })
      .from(goals)
      .where(
        and(
          isNull(goals.deletedAt),
          sql`json_extract(${goals.progressModel}, '$.metricId') = ${seed.id}`,
        ),
      );
    for (const row of direct) found.add(row.id);
  }

  let frontier = [seed.id];

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const parents = await db
      .select({ toId: relations.toId })
      .from(relations)
      .where(
        and(
          inArray(relations.fromId, frontier),
          eq(relations.kind, 'contributes_to'),
          isNull(relations.deletedAt),
        ),
      );

    const next: string[] = [];
    for (const parent of parents) {
      if (found.has(parent.toId)) continue;
      found.add(parent.toId);
      next.push(parent.toId);
    }
    frontier = next;
  }

  if (found.size === 0) return [];
  // Only goals carry progress; other endpoints fall out here.
  const rows = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(inArray(goals.id, [...found]), isNull(goals.deletedAt)));
  return rows.map((r) => r.id);
}
