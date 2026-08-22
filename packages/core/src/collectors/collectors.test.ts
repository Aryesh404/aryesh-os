import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@aryesh/db';
import { startOfUtcMonth } from '@aryesh/intelligence';
import { createTestCore, DAY, TEST_ACTOR, type TestCore } from '../testing.js';

const { readings } = schema;

/** 2026-08-15, so month boundaries are unambiguous. */
const NOW = Date.UTC(2026, 7, 15);
let c: TestCore;

beforeEach(async () => {
  c = await createTestCore(NOW);
});
afterEach(() => c.close());

const metric = (key: string, collectorKey: string, cadence = 'monthly') =>
  c.repos.metrics.create(
    {
      key,
      name: key,
      unit: 'currency',
      direction: 'increase',
      cadence,
      source: 'computed',
      aggregation: 'last',
      collectorKey,
    } as never,
    TEST_ACTOR,
  );

/** Twelve months of real transactions: ₹1L in and ₹40k out, monthly. */
async function seedTransactions(months = 12) {
  const account = await c.repos.accounts.create(
    { name: 'Business current', kind: 'bank', currency: 'INR', balanceMinor: 5_000_000 },
    TEST_ACTOR,
  );

  for (let i = 1; i <= months; i++) {
    const when = Date.UTC(2026, 7 - i, 10);
    await c.repos.transactions.create(
      {
        accountId: account.id,
        amountMinor: 10_000_000,
        currency: 'INR',
        direction: 'in',
        occurredAt: when,
        description: `Retainer ${i}`,
      },
      TEST_ACTOR,
    );
    await c.repos.transactions.create(
      {
        accountId: account.id,
        amountMinor: 4_000_000,
        currency: 'INR',
        direction: 'out',
        occurredAt: when + DAY,
        description: `Costs ${i}`,
      },
      TEST_ACTOR,
    );
  }
  return account;
}

describe('backfill from existing history (docs/12 day-one problem)', () => {
  it('rebuilds 12 months of revenue from seeded transactions', async () => {
    await seedTransactions(12);
    const m = await metric('monthly_revenue', 'finance.revenue');

    const [result] = await c.collectors.backfill(12, NOW);

    expect(result?.written).toBeGreaterThanOrEqual(11);

    const rows = await c.db
      .select()
      .from(readings)
      .where(eq(readings.metricId, m.id))
      .orderBy(readings.at);

    expect(rows.length).toBeGreaterThanOrEqual(11);
    expect(rows.every((r) => r.value === 10_000_000)).toBe(true);
    expect(rows.every((r) => r.source === 'collector')).toBe(true);
    // Readings are stamped at the start of their calendar month.
    expect(rows.every((r) => r.at === startOfUtcMonth(r.at))).toBe(true);
  });

  it('re-running is idempotent — history is updated, never doubled', async () => {
    await seedTransactions(12);
    const m = await metric('monthly_revenue', 'finance.revenue');

    await c.collectors.backfill(12, NOW);
    const first = await c.db.select().from(readings).where(eq(readings.metricId, m.id));

    await c.collectors.backfill(12, NOW);
    await c.collectors.backfill(12, NOW);
    const third = await c.db.select().from(readings).where(eq(readings.metricId, m.id));

    expect(third).toHaveLength(first.length);
  });

  it('picks up a correction to the underlying data on re-run', async () => {
    const account = await seedTransactions(3);
    const m = await metric('monthly_revenue', 'finance.revenue');
    await c.collectors.backfill(3, NOW);

    await c.repos.transactions.create(
      {
        accountId: account.id,
        amountMinor: 2_500_000,
        currency: 'INR',
        direction: 'in',
        occurredAt: Date.UTC(2026, 6, 20),
      },
      TEST_ACTOR,
    );
    await c.collectors.backfill(3, NOW);

    const july = (
      await c.db.select().from(readings).where(eq(readings.metricId, m.id))
    ).find((r) => r.at === Date.UTC(2026, 6, 1));

    expect(july?.value).toBe(12_500_000);
  });
});

describe('collector semantics', () => {
  it('writes nothing when no metric points at the collector', async () => {
    await seedTransactions(3);
    const [result] = await c.collectors.backfill(3, NOW);
    expect(result?.metricId).toBeNull();
    expect(result?.written).toBe(0);
  });

  /**
   * A month with no transactions is not a month of zero revenue. Writing 0
   * would put a fabricated data point into the trajectory.
   */
  it('skips a period with no data rather than recording zero', async () => {
    const m = await metric('monthly_revenue', 'finance.revenue');
    const [result] = await c.collectors.backfill(6, NOW);

    expect(result?.written).toBe(0);
    expect(result?.skipped).toBeGreaterThan(0);
    expect(await c.db.select().from(readings).where(eq(readings.metricId, m.id))).toHaveLength(0);
  });

  it('computes expenses, net, and savings rate consistently', async () => {
    await seedTransactions(6);
    const revenue = await metric('rev', 'finance.revenue');
    const expenses = await metric('exp', 'finance.expenses');
    const net = await metric('net', 'finance.net');
    const rate = await metric('rate', 'finance.savings_rate');

    await c.collectors.backfill(6, NOW);

    const latest = async (id: string) =>
      (await c.repos.readings.latest(id))?.value;

    expect(await latest(revenue.id)).toBe(10_000_000);
    expect(await latest(expenses.id)).toBe(4_000_000);
    expect(await latest(net.id)).toBe(6_000_000);
    expect(await latest(rate.id)).toBeCloseTo(60, 5);
  });

  it('counts tasks completed per week', async () => {
    const m = await metric('tasks_done', 'work.tasks_completed', 'weekly');
    const project = await c.repos.projects.create(
      { name: 'Retainer platform', status: 'active' },
      TEST_ACTOR,
    );

    for (let i = 0; i < 3; i++) {
      await c.repos.tasks.create(
        {
          projectId: project.id,
          title: `Task ${i}`,
          status: 'done',
          startedAt: NOW - 10 * DAY,
          completedAt: NOW - 2 * DAY,
        },
        TEST_ACTOR,
      );
    }

    await c.collectors.run(
      'work.tasks_completed',
      NOW - 30 * DAY,
      NOW + DAY,
    );

    const rows = await c.db.select().from(readings).where(eq(readings.metricId, m.id));
    expect(rows.some((r) => r.value === 3)).toBe(true);
  });

  /** Net worth is a balance, not a flow — backfilling it would be a lie. */
  it('treats net worth as current state', async () => {
    const account = await c.repos.accounts.create(
      { name: 'Savings', kind: 'bank', balanceMinor: 8_000_000 },
      TEST_ACTOR,
    );
    await c.repos.accounts.create(
      { name: 'Card', kind: 'credit', balanceMinor: 1_500_000, isLiability: true },
      TEST_ACTOR,
    );
    void account;

    const m = await metric('net_worth', 'finance.net_worth');
    await c.collectors.run('finance.net_worth', NOW - 60 * DAY, NOW + DAY);

    const rows = await c.db.select().from(readings).where(eq(readings.metricId, m.id));
    expect(rows.every((r) => r.value === 6_500_000)).toBe(true);
  });
});

describe('collectors feed progress', () => {
  it('a backfilled metric produces a goal with real history behind it', async () => {
    await seedTransactions(12);
    const m = await metric('monthly_revenue', 'finance.revenue');
    await c.repos.metrics.update(
      m.id,
      { baseline: 0, target: 50_000_000 },
      TEST_ACTOR,
    );

    const area = await c.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    );
    const goal = await c.repos.goals.create(
      {
        areaId: area.id,
        name: '₹5L MRR',
        progressModel: { mode: 'metric', metricId: m.id },
      },
      TEST_ACTOR,
    );

    await c.collectors.backfill(12, NOW);
    const outcome = await c.progress.computeAndCache(goal.id, { now: NOW });

    expect(outcome.measurable).toBe(true);
    if (!outcome.measurable || outcome.mode !== 'completion') throw new Error('expected completion');
    expect(outcome.progress.value).toBeCloseTo(0.2, 5);

    // Confidence is NOT high, and correctly so: the newest collector reading
    // sits at the start of last completed month, which is ~45 days stale for a
    // monthly cadence. The engine is supposed to notice that.
    expect(outcome.progress.confidence).toBeGreaterThan(0.4);
    expect(outcome.progress.confidence).toBeLessThan(0.7);
    expect(outcome.progress.caveats.join(' ')).toMatch(/last read/);
  });

  /**
   * Density measures gaps, not tenure: a single reading on a metric that
   * started today is complete history, and the engine is right to say so.
   * "Only three data points" is trajectory's problem to refuse (docs/04 §2),
   * not confidence's to discount.
   */
  it('a metric with gaps scores lower than one read on schedule', async () => {
    const area = await c.repos.areas.create(
      { name: 'Business', color: '#38bdf8', sortOrder: 0 },
      TEST_ACTOR,
    );

    const build = async (key: string, monthsAgoRead: number[]) => {
      const m = await c.repos.metrics.create(
        {
          key,
          name: key,
          unit: 'count',
          direction: 'increase',
          cadence: 'monthly',
          source: 'manual',
          aggregation: 'last',
          baseline: 0,
          target: 100,
        } as never,
        TEST_ACTOR,
      );
      for (const monthsAgo of monthsAgoRead) {
        await c.repos.readings.record(
          { metricId: m.id, at: NOW - monthsAgo * 30 * DAY, value: 50 },
          TEST_ACTOR,
        );
      }
      const goal = await c.repos.goals.create(
        { areaId: area.id, name: key, progressModel: { mode: 'metric', metricId: m.id } },
        TEST_ACTOR,
      );
      const outcome = await c.progress.compute(goal.id, { now: NOW });
      if (!outcome.measurable || outcome.mode !== 'completion') throw new Error(key);
      return outcome.progress;
    };

    const everyMonth = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const patchy = [11, 5, 0];

    const complete = await build('complete', everyMonth);
    const gappy = await build('gappy', patchy);

    expect(complete.confidence).toBeGreaterThan(gappy.confidence);
    expect(gappy.caveats.join(' ')).toMatch(/sparse history/);
  });
});
