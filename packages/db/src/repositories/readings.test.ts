import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, TEST_ACTOR, type TestDb } from '../testing.js';

let t: TestDb;

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

const metric = (over: Record<string, unknown> = {}) =>
  t.repos.metrics.create(
    {
      key: 'monthly_revenue',
      name: 'Monthly revenue',
      unit: 'currency',
      direction: 'increase',
      cadence: 'monthly',
      source: 'manual',
      baseline: 0,
      target: 500_000,
      ...over,
    } as never,
    TEST_ACTOR,
  );

describe('recording readings', () => {
  it('appends and keeps the metric hot path current', async () => {
    const m = await metric();

    await t.repos.readings.record({ metricId: m.id, at: T0, value: 100_000 }, TEST_ACTOR);
    await t.repos.readings.record(
      { metricId: m.id, at: T0 + 30 * DAY, value: 140_000 },
      TEST_ACTOR,
    );

    const after = await t.repos.metrics.getById(m.id);
    expect(after.lastValue).toBe(140_000);
    expect(after.lastReadingAt).toBe(T0 + 30 * DAY);

    expect(await t.repos.readings.count(m.id)).toBe(2);
    expect((await t.repos.readings.first(m.id))?.value).toBe(100_000);
    expect((await t.repos.readings.latest(m.id))?.value).toBe(140_000);
  });

  it('is idempotent, so collector re-runs and backfill are safe to repeat', async () => {
    const m = await metric();
    const reading = { metricId: m.id, at: T0, value: 100_000, source: 'collector' as const };

    await t.repos.readings.record(reading, TEST_ACTOR);
    await t.repos.readings.record(reading, TEST_ACTOR);
    await t.repos.readings.record({ ...reading, value: 110_000 }, TEST_ACTOR);

    expect(await t.repos.readings.count(m.id)).toBe(1);
    expect((await t.repos.readings.latest(m.id))?.value).toBe(110_000);
  });

  it('treats a manual entry and a collector value at the same instant as distinct', async () => {
    const m = await metric();
    await t.repos.readings.record(
      { metricId: m.id, at: T0, value: 100_000, source: 'manual' },
      TEST_ACTOR,
    );
    await t.repos.readings.record(
      { metricId: m.id, at: T0, value: 99_000, source: 'collector' },
      TEST_ACTOR,
    );
    expect(await t.repos.readings.count(m.id)).toBe(2);
  });

  it('returns a time-ordered series for a window', async () => {
    const m = await metric();
    for (let i = 0; i < 10; i++) {
      await t.repos.readings.record(
        { metricId: m.id, at: T0 + i * DAY, value: i * 1000 },
        TEST_ACTOR,
      );
    }
    const window = await t.repos.readings.series(m.id, T0 + 3 * DAY, T0 + 6 * DAY);
    expect(window.map((r) => r.value)).toEqual([3000, 4000, 5000, 6000]);
  });

  it('rejects a reading for a metric that does not exist', async () => {
    await expect(
      t.repos.readings.record({ metricId: 'nope', at: T0, value: 1 }, TEST_ACTOR),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/** docs/03 §11 — contributions are durable, returns are borrowed. */
describe('decomposed metrics', () => {
  const corpus = () =>
    metric({
      key: 'invested_corpus',
      name: 'Invested corpus',
      target: 10_000_000,
      components: [
        { key: 'contributions', label: 'Contributions', controllable: true },
        { key: 'returns', label: 'Market returns', controllable: false },
      ],
    });

  it('requires a component, naming the valid ones', async () => {
    const m = await corpus();
    const attempt = t.repos.readings.record(
      { metricId: m.id, at: T0, value: 4_100_000 },
      TEST_ACTOR,
    );
    await expect(attempt).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(attempt).rejects.toThrow(/contributions, returns/);
  });

  it('rejects an unknown component', async () => {
    const m = await corpus();
    await expect(
      t.repos.readings.record(
        { metricId: m.id, at: T0, value: 1, component: 'dividends' },
        TEST_ACTOR,
      ),
    ).rejects.toThrow(/no component 'dividends'/);
  });

  it('keeps components separate so growth can be attributed', async () => {
    const m = await corpus();
    await t.repos.readings.record(
      { metricId: m.id, at: T0, value: 2_600_000, component: 'contributions' },
      TEST_ACTOR,
    );
    await t.repos.readings.record(
      { metricId: m.id, at: T0, value: 1_500_000, component: 'returns' },
      TEST_ACTOR,
    );

    expect((await t.repos.readings.latest(m.id, 'contributions'))?.value).toBe(2_600_000);
    expect((await t.repos.readings.latest(m.id, 'returns'))?.value).toBe(1_500_000);
    expect(await t.repos.readings.count(m.id)).toBe(2);
  });
});

describe('history outlives the metric', () => {
  it('keeps readings when the metric is archived — deleting history rewrites the past', async () => {
    const m = await metric();
    await t.repos.readings.record({ metricId: m.id, at: T0, value: 100_000 }, TEST_ACTOR);

    await t.repos.metrics.softDelete(m.id, TEST_ACTOR);

    expect(await t.repos.metrics.findById(m.id)).toBeUndefined();
    expect(await t.repos.readings.count(m.id)).toBe(1);

    await t.repos.metrics.restore(m.id, TEST_ACTOR);
    expect((await t.repos.readings.latest(m.id))?.value).toBe(100_000);
  });
});
