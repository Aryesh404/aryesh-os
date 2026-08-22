import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * A durable queue on libSQL. A Redis dependency is unjustifiable for one user on
 * one machine (docs/01 §3), and durability matters more than throughput: a
 * missed nightly snapshot is a permanent hole in the trajectory.
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    /** Earliest time this may run. Also the retry backoff target. */
    runAt: integer('run_at').notNull(),
    state: text('state').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lastError: text('last_error'),
    /** Set while a worker holds the job, so a crash can be recovered. */
    lockedAt: integer('locked_at'),
    /**
     * Dedupe key. A pending job with the same key is not queued twice — the
     * nightly snapshot must not pile up if the app was closed for a week.
     */
    dedupeKey: text('dedupe_key'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_jobs_ready').on(t.state, t.runAt),
    index('idx_jobs_dedupe').on(t.dedupeKey, t.state),
  ],
);
