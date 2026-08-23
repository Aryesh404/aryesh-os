import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@aryesh/db';
import { JOB_KINDS } from '../create-core.js';
import { createTestCore, DAY, TEST_ACTOR, type TestCore } from '../testing.js';

const { jobs, goalSnapshots } = schema;
const T0 = 1_700_000_000_000;

let c: TestCore;
beforeEach(async () => {
  c = await createTestCore(T0);
});
afterEach(() => c.close());

describe('enqueue and run', () => {
  it('runs a due job and marks it done', async () => {
    const seen: string[] = [];
    c.jobs.register('test.echo', async (payload) => {
      seen.push(String(payload['message']));
    });

    await c.jobs.enqueue('test.echo', { message: 'hello' });
    expect(await c.jobs.runNext()).toBe(true);

    expect(seen).toEqual(['hello']);
    expect(await c.jobs.pendingCount()).toBe(0);
  });

  it('does not run a job scheduled for the future', async () => {
    c.jobs.register('test.later', async () => undefined);
    await c.jobs.enqueue('test.later', {}, { runAt: T0 + DAY });

    expect(await c.jobs.runNext()).toBe(false);
    expect(await c.jobs.pendingCount()).toBe(1);

    c.setNow(T0 + DAY);
    expect(await c.jobs.runNext()).toBe(true);
  });

  it('drains everything due, in schedule order', async () => {
    const order: number[] = [];
    c.jobs.register('test.order', async (p) => {
      order.push(Number(p['n']));
    });

    await c.jobs.enqueue('test.order', { n: 3 }, { runAt: T0 - 1000 });
    await c.jobs.enqueue('test.order', { n: 1 }, { runAt: T0 - 3000 });
    await c.jobs.enqueue('test.order', { n: 2 }, { runAt: T0 - 2000 });

    expect(await c.jobs.drain()).toBe(3);
    expect(order).toEqual([1, 2, 3]);
  });
});

/**
 * The nightly snapshot must not pile up while the app is closed for a week:
 * one pending snapshot is worth the same as seven queued ones.
 */
describe('dedupe', () => {
  it('will not queue a second pending job with the same key', async () => {
    c.jobs.register('test.dedupe', async () => undefined);

    const first = await c.jobs.enqueue('test.dedupe', {}, { dedupeKey: 'nightly' });
    const second = await c.jobs.enqueue('test.dedupe', {}, { dedupeKey: 'nightly' });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await c.jobs.pendingCount()).toBe(1);
  });

  it('allows the same key again once the first has run', async () => {
    c.jobs.register('test.dedupe', async () => undefined);
    await c.jobs.enqueue('test.dedupe', {}, { dedupeKey: 'nightly' });
    await c.jobs.runNext();

    expect(await c.jobs.enqueue('test.dedupe', {}, { dedupeKey: 'nightly' })).not.toBeNull();
  });
});

describe('failure handling', () => {
  it('retries with backoff, then gives up and records why', async () => {
    let attempts = 0;
    c.jobs.register('test.flaky', async () => {
      attempts++;
      throw new Error('nope');
    });

    const id = await c.jobs.enqueue('test.flaky', {}, { maxAttempts: 3 });

    await c.jobs.runNext();
    expect(attempts).toBe(1);
    // Backed off, so it is not immediately due again.
    expect(await c.jobs.runNext()).toBe(false);

    c.setNow(T0 + 5 * 60_000);
    await c.jobs.runNext();
    c.setNow(T0 + 60 * 60_000);
    await c.jobs.runNext();

    expect(attempts).toBe(3);

    const [row] = await c.db.select().from(jobs).where(eq(jobs.id, id as string));
    expect(row?.state).toBe('failed');
    expect(row?.lastError).toBe('nope');
    expect(row?.attempts).toBe(3);
  });

  it('fails a job with no registered handler rather than looping on it', async () => {
    const id = await c.jobs.enqueue('test.unknown', {});
    expect(await c.jobs.runNext()).toBe(true);

    const [row] = await c.db.select().from(jobs).where(eq(jobs.id, id as string));
    expect(row?.state).toBe('failed');
    expect(row?.lastError).toMatch(/no handler registered/);
  });

  it('recovers a job whose worker died holding the lock', async () => {
    c.jobs.register('test.stuck', async () => undefined);
    const id = await c.jobs.enqueue('test.stuck', {});

    // Simulate a crash mid-run: locked, still pending.
    await c.db.update(jobs).set({ lockedAt: T0 }).where(eq(jobs.id, id as string));
    expect(await c.jobs.runNext()).toBe(false);

    c.setNow(T0 + 11 * 60_000);
    expect(await c.jobs.runNext()).toBe(true);
  });
});

describe('the jobs the core registers for itself', () => {
  it('runs the nightly snapshot through the queue', async () => {
    const area = await c.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    );
    await c.repos.goals.create({ areaId: area.id, name: 'A goal' }, TEST_ACTOR);

    await c.jobs.enqueue(JOB_KINDS.snapshot, { at: T0 }, { dedupeKey: `snapshot:${T0}` });
    await c.jobs.drain();

    expect(await c.db.select().from(goalSnapshots)).toHaveLength(1);
  });

  it('runs collectors through the queue', async () => {
    const account = await c.repos.accounts.create(
      { name: 'Bank', kind: 'bank', balanceMinor: 100 },
      TEST_ACTOR,
    );
    await c.repos.transactions.create(
      {
        accountId: account.id,
        amountMinor: 5_000,
        currency: 'INR',
        direction: 'in',
        occurredAt: T0 - 5 * DAY,
      },
      TEST_ACTOR,
    );
    const metric = await c.repos.metrics.create(
      {
        key: 'rev',
        name: 'Revenue',
        unit: 'currency',
        direction: 'increase',
        cadence: 'monthly',
        source: 'computed',
        aggregation: 'last',
        collectorKey: 'finance.revenue',
      } as never,
      TEST_ACTOR,
    );

    await c.jobs.enqueue(JOB_KINDS.collect, {
      key: 'finance.revenue',
      from: T0 - 40 * DAY,
      to: T0,
    });
    await c.jobs.drain();

    expect(await c.repos.readings.count(metric.id)).toBeGreaterThan(0);
  });
});

describe('scheduler', () => {
  it('snapshots today once, however many times it ticks', async () => {
    const { createScheduler } = await import('./scheduler.js');
    const area = await c.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    );
    await c.repos.goals.create({ areaId: area.id, name: 'A goal' }, TEST_ACTOR);

    const scheduler = createScheduler(c);

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    expect(await c.db.select().from(goalSnapshots)).toHaveLength(1);
  });

  /**
   * Progress is computed from the readings that exist *now*, so back-filling a
   * missed day would stamp today's figure onto a date it was never true. A gap
   * is honest; an invented point is indistinguishable from a real one once
   * written (docs/03 §7).
   */
  it('leaves days the app was closed empty rather than inventing them', async () => {
    const { createScheduler } = await import('./scheduler.js');
    const area = await c.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    );
    await c.repos.goals.create({ areaId: area.id, name: 'A goal' }, TEST_ACTOR);

    const scheduler = createScheduler(c);
    await scheduler.tick();

    // A week later, after the app was closed the whole time.
    c.setNow(T0 + 7 * DAY);
    await scheduler.tick();

    const snapshots = await c.db.select().from(goalSnapshots);
    expect(snapshots).toHaveLength(2);
    const dates = snapshots.map((s) => s.date).sort((a, b) => a - b);
    expect((dates[1]! - dates[0]!) / DAY).toBe(7);
  });
});
