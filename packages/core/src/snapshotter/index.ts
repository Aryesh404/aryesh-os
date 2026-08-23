import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { newId, schema } from '@aryesh/db';
import { periodsBetween, startOfUtcDay } from '@aryesh/intelligence';
import type { ProgressService } from '../progress/service.js';
import type { EventBus } from '../events/bus.js';

const { goals, goalSnapshots, metrics, metricSnapshots, readings } = schema;

/**
 * docs/03 §7 — snapshots are what make trajectory possible, and they cannot be
 * reconstructed after the fact. A goal whose model changed last month cannot
 * have last month's progress recomputed honestly, so they start being written
 * before anything displays them.
 */

export interface SnapshotterDeps {
  db: Db;
  clock: () => number;
  progress: ProgressService;
  events?: EventBus;
}

export interface SnapshotResult {
  date: number;
  /** Rows written, measurable or not — every goal gets one. */
  goals: number;
  /** Of those, how many produced an actual figure. */
  measured: number;
  /** Of those, how many recorded a reason instead. */
  skipped: number;
  metrics: number;
}

export function createSnapshotter({ db, clock, progress, events }: SnapshotterDeps) {
  const snapshotter = {
    /**
     * Writes one row per goal and per metric for the given day. Idempotent:
     * running twice on the same day updates rather than duplicates, so a manual
     * run after the nightly job is harmless.
     */
    async run(at?: number): Promise<SnapshotResult> {
      const now = at ?? clock();
      const date = startOfUtcDay(now);

      const goalRows = await db
        .select({ id: goals.id })
        .from(goals)
        .where(isNull(goals.deletedAt));

      let measured = 0;
      let skipped = 0;

      for (const { id } of goalRows) {
        const outcome = await progress.computeAndCache(id, { now });

        const breakdown =
          outcome.measurable
            ? (outcome.mode === 'completion' ? outcome.progress : outcome.momentum).inputs.map(
                (input) => ({
                  kind: input.ref.kind,
                  refId: input.ref.id,
                  label: input.label,
                  weight: input.weight ?? 0,
                  value: input.value,
                }),
              )
            : [];

        // An unmeasurable goal still gets a row. A gap in the series would read
        // later as "no data recorded", when the truth is "we tried and it could
        // not be measured" — and the reason is worth keeping.
        await db
          .insert(goalSnapshots)
          .values({
            id: newId(),
            goalId: id,
            date,
            mode: outcome.measurable ? outcome.mode : 'completion',
            progress:
              outcome.measurable && outcome.mode === 'completion'
                ? outcome.progress.value
                : null,
            momentum:
              outcome.measurable && outcome.mode === 'momentum'
                ? outcome.momentum.value
                : null,
            confidence: outcome.measurable
              ? (outcome.mode === 'completion' ? outcome.progress : outcome.momentum).confidence
              : 0,
            degradedReason: outcome.measurable
              ? (outcome.degraded?.reason ?? null)
              : outcome.reason,
            breakdown,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [goalSnapshots.goalId, goalSnapshots.date],
            set: {
              mode: sql`excluded.mode`,
              progress: sql`excluded.progress`,
              momentum: sql`excluded.momentum`,
              confidence: sql`excluded.confidence`,
              degradedReason: sql`excluded.degraded_reason`,
              breakdown: sql`excluded.breakdown`,
            },
          });

        if (outcome.measurable) measured++;
        else skipped++;
      }

      const metricCount = await snapshotter.rollupMetrics(now);

      await events?.emit('snapshot.written', {
        date,
        goals: goalRows.length,
        metrics: metricCount,
      });

      return { date, goals: goalRows.length, measured, skipped, metrics: metricCount };
    },

    /**
     * The series behind a trajectory chart: one indexed range scan, ordered
     * oldest first so the chart can draw it directly.
     */
    async history(
      goalId: string,
      options: { from?: number; to?: number; limit?: number } = {},
    ) {
      const clauses = [eq(goalSnapshots.goalId, goalId)];
      if (options.from !== undefined) clauses.push(gte(goalSnapshots.date, options.from));
      if (options.to !== undefined) clauses.push(lt(goalSnapshots.date, options.to));

      return db
        .select()
        .from(goalSnapshots)
        .where(and(...clauses))
        .orderBy(goalSnapshots.date)
        .limit(options.limit ?? 400);
    },

    /**
     * Period rollups per metric, so a two-year chart is a range scan rather
     * than a reduction over half a million readings.
     */
    async rollupMetrics(now: number, windowDays = 400): Promise<number> {
      const metricRows = await db
        .select({
          id: metrics.id,
          cadence: metrics.cadence,
          aggregation: metrics.aggregation,
        })
        .from(metrics)
        .where(isNull(metrics.deletedAt));

      const from = startOfUtcDay(now) - windowDays * 86_400_000;
      let count = 0;

      for (const metric of metricRows) {
        const periods = periodsBetween(metric.cadence, from, now);

        for (const period of periods) {
          const rows = await db
            .select({ value: readings.value, at: readings.at })
            .from(readings)
            .where(
              and(
                eq(readings.metricId, metric.id),
                gte(readings.at, period.start),
                lt(readings.at, period.end),
                eq(readings.component, ''),
              ),
            )
            .orderBy(readings.at);

          if (rows.length === 0) continue;

          const values = rows.map((r) => r.value);
          const value = aggregate(metric.aggregation, values);

          await db
            .insert(metricSnapshots)
            .values({
              metricId: metric.id,
              period: metric.cadence,
              periodStart: period.start,
              value,
              readingCount: rows.length,
              createdAt: now,
            })
            .onConflictDoUpdate({
              target: [
                metricSnapshots.metricId,
                metricSnapshots.period,
                metricSnapshots.periodStart,
              ],
              set: {
                value: sql`excluded.value`,
                readingCount: sql`excluded.reading_count`,
              },
            });
          count++;
        }
      }

      return count;
    },
  };

  return snapshotter;
}

export type Snapshotter = ReturnType<typeof createSnapshotter>;

function aggregate(how: string, values: number[]): number {
  const last = values[values.length - 1] ?? 0;
  switch (how) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'max':
      return Math.max(...values);
    case 'min':
      return Math.min(...values);
    default:
      return last;
  }
}
