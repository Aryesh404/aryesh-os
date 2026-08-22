import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@aryesh/db';
import { newId, schema } from '@aryesh/db';

const { jobs } = schema;

/**
 * A durable queue on libSQL. Durability matters more than throughput here: a
 * missed nightly snapshot is a permanent hole in the trajectory, and a Redis
 * dependency is unjustifiable for one user on one machine (docs/01 §3).
 */

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface EnqueueOptions {
  runAt?: number;
  maxAttempts?: number;
  /**
   * A pending job with the same key is not queued twice, so the nightly
   * snapshot cannot pile up while the app is closed for a week.
   */
  dedupeKey?: string;
}

export interface QueueDeps {
  db: Db;
  clock: () => number;
  /** Backoff before a retry. Exponential by attempt, in ms. */
  backoff?: (attempt: number) => number;
  onError?: (kind: string, error: unknown) => void;
}

const defaultBackoff = (attempt: number): number =>
  Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000);

/** A job locked for longer than this is presumed dead and is retried. */
const LOCK_TIMEOUT_MS = 10 * 60_000;

export function createJobQueue(deps: QueueDeps) {
  const { db, clock } = deps;
  const backoff = deps.backoff ?? defaultBackoff;
  const handlers = new Map<string, JobHandler>();

  const queue = {
    register(kind: string, handler: JobHandler): void {
      handlers.set(kind, handler);
    },

    async enqueue(
      kind: string,
      payload: Record<string, unknown> = {},
      options: EnqueueOptions = {},
    ): Promise<string | null> {
      const now = clock();

      if (options.dedupeKey !== undefined) {
        const existing = (
          await db
            .select({ id: jobs.id })
            .from(jobs)
            .where(and(eq(jobs.dedupeKey, options.dedupeKey), eq(jobs.state, 'pending')))
            .limit(1)
        )[0];
        if (existing) return null;
      }

      const id = newId();
      await db.insert(jobs).values({
        id,
        kind,
        payload,
        runAt: options.runAt ?? now,
        state: 'pending',
        attempts: 0,
        maxAttempts: options.maxAttempts ?? 3,
        lastError: null,
        lockedAt: null,
        dedupeKey: options.dedupeKey ?? null,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },

    /** Claims one ready job and runs it. Returns false when nothing was due. */
    async runNext(): Promise<boolean> {
      const now = clock();

      const candidate = (
        await db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.state, 'pending'),
              lte(jobs.runAt, now),
              or(isNull(jobs.lockedAt), lte(jobs.lockedAt, now - LOCK_TIMEOUT_MS)),
            ),
          )
          .orderBy(asc(jobs.runAt))
          .limit(1)
      )[0];

      if (!candidate) return false;

      // Claim it. The `lockedAt IS NULL` guard makes the claim atomic enough
      // for a single process with concurrent timers.
      const claimed = await db
        .update(jobs)
        .set({ lockedAt: now, attempts: candidate.attempts + 1, updatedAt: now })
        .where(
          and(
            eq(jobs.id, candidate.id),
            or(isNull(jobs.lockedAt), lte(jobs.lockedAt, now - LOCK_TIMEOUT_MS)),
          ),
        )
        .returning({ id: jobs.id });

      if (claimed.length === 0) return false;

      const handler = handlers.get(candidate.kind);
      if (!handler) {
        await db
          .update(jobs)
          .set({
            state: 'failed',
            lastError: `no handler registered for '${candidate.kind}'`,
            lockedAt: null,
            updatedAt: now,
          })
          .where(eq(jobs.id, candidate.id));
        return true;
      }

      try {
        await handler(candidate.payload);
        await db
          .update(jobs)
          .set({ state: 'done', lockedAt: null, lastError: null, updatedAt: clock() })
          .where(eq(jobs.id, candidate.id));
      } catch (error) {
        const attempts = candidate.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        const exhausted = attempts >= candidate.maxAttempts;

        await db
          .update(jobs)
          .set({
            state: exhausted ? 'failed' : 'pending',
            runAt: exhausted ? candidate.runAt : clock() + backoff(attempts),
            lastError: message,
            lockedAt: null,
            updatedAt: clock(),
          })
          .where(eq(jobs.id, candidate.id));

        deps.onError?.(candidate.kind, error);
      }

      return true;
    },

    /** Drains everything currently due. Returns how many ran. */
    async drain(limit = 100): Promise<number> {
      let ran = 0;
      while (ran < limit && (await queue.runNext())) ran++;
      return ran;
    },

    async pendingCount(): Promise<number> {
      const row = (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(jobs)
          .where(eq(jobs.state, 'pending'))
      )[0];
      return row?.n ?? 0;
    },

    async failed(): Promise<Array<typeof jobs.$inferSelect>> {
      return db.select().from(jobs).where(eq(jobs.state, 'failed'));
    },
  };

  return queue;
}

export type JobQueue = ReturnType<typeof createJobQueue>;
