import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { AppError, type Actor } from '@aryesh/domain';

import { metrics, readings } from '../schema/index.js';
import { newId } from '../ids.js';
import type { Ctx, RepoDeps } from './base.js';

export interface RecordReadingInput {
  metricId: string;
  at: number;
  value: number;
  /** Required when the metric declares components (docs/03 §11). */
  component?: string;
  source?: 'manual' | 'collector' | 'derived' | 'import';
  note?: string;
}

/**
 * Readings are append-only. There is no update and no delete: a correction is a
 * new reading superseding the old, so the history of what was believed when
 * stays intact. Deleting a metric never deletes its readings (docs/02 §4).
 */
export function createReadingsRepository(deps: RepoDeps) {
  const { db, clock } = deps;

  const repo = {
    async record(input: RecordReadingInput, ctx: Ctx) {
      const metric = (
        await db.select().from(metrics).where(eq(metrics.id, input.metricId)).limit(1)
      )[0];
      if (!metric) {
        throw new AppError('NOT_FOUND', `metric ${input.metricId} not found`, {
          metricId: input.metricId,
        });
      }

      const components = metric.components ?? [];
      if (components.length > 0 && input.component === undefined) {
        throw new AppError(
          'INVALID_INPUT',
          `metric '${metric.key}' is decomposed — a reading must name a component: ${components
            .map((c) => c.key)
            .join(', ')}`,
          { metricId: metric.id, components: components.map((c) => c.key) },
        );
      }
      if (input.component !== undefined && !components.some((c) => c.key === input.component)) {
        throw new AppError(
          'INVALID_INPUT',
          `metric '${metric.key}' has no component '${input.component}'`,
          { metricId: metric.id, components: components.map((c) => c.key) },
        );
      }

      const source = input.source ?? 'manual';
      const row = {
        id: newId(),
        metricId: input.metricId,
        at: input.at,
        value: input.value,
        component: input.component ?? '',
        source,
        note: input.note ?? null,
        actor: ctx.actor as Actor,
        createdAt: clock(),
      };

      // Idempotent by (metric, at, source, component) so collector re-runs and
      // backfill are safe to repeat (docs/12).
      await db
        .insert(readings)
        .values(row)
        .onConflictDoUpdate({
          target: [readings.metricId, readings.at, readings.source, readings.component],
          set: { value: row.value, note: row.note, actor: row.actor },
        });

      await repo.refreshDenormalised(input.metricId);
      return row;
    },

    /** Keeps `metrics.lastReadingAt` / `lastValue` true after any write. */
    async refreshDenormalised(metricId: string): Promise<void> {
      const latest = (
        await db
          .select({ at: readings.at, value: readings.value })
          .from(readings)
          .where(eq(readings.metricId, metricId))
          .orderBy(desc(readings.at))
          .limit(1)
      )[0];

      await db
        .update(metrics)
        .set({
          lastReadingAt: latest?.at ?? null,
          lastValue: latest?.value ?? null,
        })
        .where(eq(metrics.id, metricId));
    },

    async latest(metricId: string, component?: string) {
      const clauses = [eq(readings.metricId, metricId)];
      if (component !== undefined) clauses.push(eq(readings.component, component));
      else clauses.push(eq(readings.component, ''));
      const rows = await db
        .select()
        .from(readings)
        .where(and(...clauses))
        .orderBy(desc(readings.at))
        .limit(1);
      return rows[0];
    },

    async first(metricId: string) {
      const rows = await db
        .select()
        .from(readings)
        .where(eq(readings.metricId, metricId))
        .orderBy(readings.at)
        .limit(1);
      return rows[0];
    },

    /** Time-ordered series for charts and velocity. Indexed range scan. */
    async series(metricId: string, from?: number, to?: number) {
      const clauses = [eq(readings.metricId, metricId)];
      if (from !== undefined) clauses.push(gte(readings.at, from));
      if (to !== undefined) clauses.push(lte(readings.at, to));
      return db
        .select()
        .from(readings)
        .where(and(...clauses))
        .orderBy(readings.at);
    },

    async count(metricId: string): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`count(*)` })
        .from(readings)
        .where(eq(readings.metricId, metricId));
      return rows[0]?.n ?? 0;
    },
  };

  return repo;
}

export type ReadingsRepository = ReturnType<typeof createReadingsRepository>;
