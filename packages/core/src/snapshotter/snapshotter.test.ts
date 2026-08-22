import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@aryesh/db';
import { startOfUtcDay } from '@aryesh/intelligence';
import { createTestCore, DAY, TEST_ACTOR, type TestCore } from '../testing.js';

const { goalSnapshots, metricSnapshots } = schema;

const T0 = 1_700_000_000_000;
let c: TestCore;

beforeEach(async () => {
  c = await createTestCore(T0);
});
afterEach(() => c.close());

async function seed() {
  const area = await c.repos.areas.create(
    { name: 'Business', color: '#38bdf8', sortOrder: 0 },
    TEST_ACTOR,
  );

  const metric = await c.repos.metrics.create(
    {
      key: 'monthly_revenue',
      name: 'Monthly revenue',
      unit: 'currency',
      direction: 'increase',
      cadence: 'monthly',
      source: 'manual',
      aggregation: 'last',
      baseline: 0,
      target: 500_000,
    } as never,
    TEST_ACTOR,
  );

  const goal = await c.repos.goals.create(
    {
      areaId: area.id,
      name: '₹5L MRR by March 2027',
      measurementMode: 'completion',
      progressModel: { mode: 'metric', metricId: metric.id },
    },
    TEST_ACTOR,
  );

  await c.repos.readings.record(
    { metricId: metric.id, at: T0 - DAY, value: 140_000 },
    TEST_ACTOR,
  );

  return { area, metric, goal };
}

describe('nightly snapshot', () => {
  it('writes a row for every goal and rolls up every metric', async () => {
    const { goal, metric } = await seed();

    const result = await c.snapshots.run();

    expect(result.goals).toBe(1);
    expect(result.metrics).toBeGreaterThan(0);
    expect(result.date).toBe(startOfUtcDay(T0));

    const [snapshot] = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id));

    expect(snapshot?.progress).toBeCloseTo(0.28, 5);
    expect(snapshot?.mode).toBe('completion');
    expect(snapshot?.confidence).toBeGreaterThan(0);
    expect(snapshot?.breakdown).toHaveLength(1);
    expect(snapshot?.breakdown[0]?.label).toBe('monthly_revenue');

    const rollups = await c.db
      .select()
      .from(metricSnapshots)
      .where(eq(metricSnapshots.metricId, metric.id));
    expect(rollups.length).toBeGreaterThan(0);
    expect(rollups.some((r) => r.value === 140_000)).toBe(true);
  });

  it('is idempotent — a second run updates rather than duplicates', async () => {
    const { goal } = await seed();

    await c.snapshots.run();
    await c.snapshots.run();

    const rows = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id));
    expect(rows).toHaveLength(1);
  });

  it('reflects a changed reading when re-run the same day', async () => {
    const { goal, metric } = await seed();
    await c.snapshots.run();

    await c.repos.readings.record(
      { metricId: metric.id, at: T0, value: 250_000 },
      TEST_ACTOR,
    );
    await c.snapshots.run();

    const [row] = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id));
    expect(row?.progress).toBeCloseTo(0.5, 5);
  });

  /**
   * A gap in the series would later read as "no data recorded", when the truth
   * is "we tried and it could not be measured". The reason is worth keeping.
   */
  it('writes a row for an unmeasurable goal, carrying the reason', async () => {
    const area = await c.repos.areas.create(
      { name: 'Career', color: '#34d399', sortOrder: 1 },
      TEST_ACTOR,
    );
    const goal = await c.repos.goals.create(
      { areaId: area.id, name: 'No contributors yet' },
      TEST_ACTOR,
    );

    const result = await c.snapshots.run();
    expect(result.skipped).toBe(1);

    const [row] = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id));

    expect(row).toBeDefined();
    expect(row?.progress).toBeNull();
    expect(row?.degradedReason).toMatch(/no contributors/);
  });

  it('records a momentum goal as momentum, with no percentage', async () => {
    const area = await c.repos.areas.create(
      { name: 'Career', color: '#34d399', sortOrder: 1 },
      TEST_ACTOR,
    );
    const metric = await c.repos.metrics.create(
      {
        key: 'projects_shipped',
        name: 'Projects shipped',
        unit: 'count',
        direction: 'increase',
        cadence: 'monthly',
        source: 'manual',
        aggregation: 'sum',
        bounded: false,
      } as never,
      TEST_ACTOR,
    );
    const goal = await c.repos.goals.create(
      { areaId: area.id, name: 'Become a stronger engineer', measurementMode: 'momentum' },
      TEST_ACTOR,
    );
    await c.repos.relations.create(
      {
        kind: 'contributes_to',
        fromType: 'metric',
        fromId: metric.id,
        toType: 'goal',
        toId: goal.id,
        expectedRate: { value: 1, per: 'month' },
      },
      TEST_ACTOR,
    );
    for (let i = 1; i <= 3; i++) {
      await c.repos.readings.record(
        { metricId: metric.id, at: T0 - i * 20 * DAY, value: 1 },
        TEST_ACTOR,
      );
    }

    await c.snapshots.run();

    const [row] = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id));

    expect(row?.mode).toBe('momentum');
    expect(row?.progress).toBeNull();
    expect(row?.momentum).toBeGreaterThan(0);
  });

  it('emits snapshot.written', async () => {
    await seed();
    await c.snapshots.run();
    expect(c.events.emitted.some((e) => e.event === 'snapshot.written')).toBe(true);
  });

  it('accumulates a series across days — the input trajectory needs', async () => {
    const { goal, metric } = await seed();

    for (let day = 0; day < 5; day++) {
      const at = T0 + day * DAY;
      c.setNow(at);
      await c.repos.readings.record(
        { metricId: metric.id, at, value: 140_000 + day * 20_000 },
        TEST_ACTOR,
      );
      await c.snapshots.run(at);
    }

    const rows = await c.db
      .select()
      .from(goalSnapshots)
      .where(eq(goalSnapshots.goalId, goal.id))
      .orderBy(goalSnapshots.date);

    expect(rows).toHaveLength(5);
    const progress = rows.map((r) => r.progress as number);
    expect(progress[0]).toBeCloseTo(0.28, 5);
    expect(progress[4]).toBeCloseTo(0.44, 5);
    // Monotonically rising, which is what a trajectory chart will draw.
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });
});
