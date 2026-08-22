import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { schema } from '@aryesh/db';
import { periodsBetween, type Period } from '@aryesh/intelligence';
import type { Cadence, MetricUnit } from '@aryesh/domain';
import type { EventBus } from '../events/bus.js';

const { metrics } = schema;

/**
 * docs/03 §2 — a collector turns domain state into a reading. This is the only
 * code-level extension point in the measurement layer, and it is intentionally
 * narrow.
 *
 * Collectors are pure functions of `(period, data)`, which is what makes the
 * same code able to compute today and to rebuild the last two years from
 * history — the answer to the day-one problem in docs/12.
 */
export interface Collector {
  key: string;
  name: string;
  unit: MetricUnit;
  cadence: Cadence;
  /** Null means "no data for this period", which is not the same as zero. */
  compute(period: Period, db: Db): Promise<number | null>;
}

export interface CollectorRunResult {
  key: string;
  metricId: string | null;
  periods: number;
  written: number;
  skipped: number;
}

export interface CollectorDeps {
  db: Db;
  clock: () => number;
  events?: EventBus;
  recordReading: (input: {
    metricId: string;
    at: number;
    value: number;
    source: 'collector';
  }) => Promise<unknown>;
}

export function createCollectorRunner(deps: CollectorDeps, collectors: Collector[]) {
  const byKey = new Map(collectors.map((c) => [c.key, c]));

  const runner = {
    list: () => [...byKey.values()],

    get: (key: string) => byKey.get(key),

    /**
     * Runs one collector over every period in a range and records a reading per
     * period. Re-running is safe: readings are idempotent by
     * `(metric, at, source, component)`, so a repeated backfill updates rather
     * than duplicates (docs/09).
     */
    async run(key: string, from: number, to: number): Promise<CollectorRunResult> {
      const collector = byKey.get(key);
      if (!collector) {
        return { key, metricId: null, periods: 0, written: 0, skipped: 0 };
      }

      // A collector only writes to a metric the user actually created and
      // pointed at it. Registering a collector does not conjure a metric.
      const metric = (
        await deps.db
          .select({ id: metrics.id })
          .from(metrics)
          .where(and(eq(metrics.collectorKey, key), isNull(metrics.deletedAt)))
          .limit(1)
      )[0];

      if (!metric) {
        return { key, metricId: null, periods: 0, written: 0, skipped: 0 };
      }

      const periods = periodsBetween(collector.cadence, from, to);
      let written = 0;
      let skipped = 0;

      for (const period of periods) {
        const value = await collector.compute(period, deps.db);
        if (value === null) {
          skipped++;
          continue;
        }
        // Stamped at the period's start, so re-running lands on the same row.
        await deps.recordReading({
          metricId: metric.id,
          at: period.start,
          value,
          source: 'collector',
        });
        written++;
      }

      await deps.events?.emit('collector.ran', { key, periods: periods.length, written });
      return { key, metricId: metric.id, periods: periods.length, written, skipped };
    },

    /** Runs every registered collector that has a metric pointing at it. */
    async runAll(from: number, to: number): Promise<CollectorRunResult[]> {
      const results: CollectorRunResult[] = [];
      for (const collector of byKey.values()) {
        results.push(await runner.run(collector.key, from, to));
      }
      return results;
    },

    /** Rebuilds history from existing domain data (docs/12 day-one problem). */
    async backfill(months: number, now: number): Promise<CollectorRunResult[]> {
      const from = new Date(now);
      from.setUTCMonth(from.getUTCMonth() - months);
      return runner.runAll(from.getTime(), now);
    },
  };

  return runner;
}

export type CollectorRunner = ReturnType<typeof createCollectorRunner>;
