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
     *
     * One query per metric, bucketed in memory. The obvious shape — a query per
     * period — is 400 round trips per daily metric, which turned a five-second
     * nightly job into twenty.
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
      const pending: Array<typeof metricSnapshots.$inferInsert> = [];

      for (const metric of metricRows) {
        const rows = await db
          .select({ at: readings.at, value: readings.value })
          .from(readings)
          .where(
            and(
              eq(readings.metricId, metric.id),
              gte(readings.at, from),
              lt(readings.at, now),
              eq(readings.component, ''),
            ),
          )
          .orderBy(readings.at);

        if (rows.length === 0) continue;

        // Walk periods and readings together; both are sorted, so this is one
        // pass rather than a scan per period.
        const periods = periodsBetween(metric.cadence, from, now);
        let cursor = 0;

        for (const period of periods) {
          const values: number[] = [];
          while (cursor < rows.length && (rows[cursor] as { at: number }).at < period.start) {
            cursor++;
          }
          let peek = cursor;
          while (peek < rows.length && (rows[peek] as { at: number }).at < period.end) {
            values.push((rows[peek] as { value: number }).value);
            peek++;
          }
          if (values.length === 0) continue;

          pending.push({
            metricId: metric.id,
            period: metric.cadence,
            periodStart: period.start,
            value: aggregate(metric.aggregation, values),
            readingCount: values.length,
            createdAt: now,
          });
        }
      }

      // Batched: one statement per 200 rollups rather than one per rollup.
      for (let i = 0; i < pending.length; i += 200) {
        await db
          .insert(metricSnapshots)
          .values(pending.slice(i, i + 200))
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
      }

      return pending.length;
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
