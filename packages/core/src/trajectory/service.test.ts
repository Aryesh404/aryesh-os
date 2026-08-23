import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestCore, DAY, TEST_ACTOR, type TestCore } from '../testing.js';

const NOW = Date.UTC(2026, 7, 15);
let c: TestCore;

beforeEach(async () => {
  c = await createTestCore(NOW);
});
afterEach(() => c.close());

/**
 * docs/04 §2 — a compounding projection needs the corpus's current value and
 * its target. Neither is stored on the goal: they belong to the metric, and a
 * stored copy would drift from the readings the moment one landed.
 *
 * Before M9 the API's stored model omitted both and the service cast it with
 * `as never`, so a compounding goal produced NaN — which is why the ₹1 Cr case
 * could only ever be projected linearly.
 */
async function corpusGoal(target: number) {
  const area = await c.repos.areas.create(
    { name: 'Finance', color: '#34d399', sortOrder: 0 },
    TEST_ACTOR,
  );
  const metric = await c.repos.metrics.create(
    {
      key: 'invested_corpus',
      name: 'Invested corpus',
      unit: 'currency',
      direction: 'increase',
      cadence: 'monthly',
      source: 'manual',
      aggregation: 'last',
      baseline: 0,
      target,
    } as never,
    TEST_ACTOR,
  );
  await c.repos.readings.record(
    { metricId: metric.id, at: NOW, value: 5_156_900 },
    TEST_ACTOR,
  );

  const goal = await c.repos.goals.create(
    {
      areaId: area.id,
      name: '₹1 Cr invested corpus',
      progressModel: { mode: 'metric', metricId: metric.id },
      projectionModel: {
        kind: 'compounding',
        annualRate: 0.11,
        contribution: { amount: 85_000, per: 'month' },
        scenarios: [0.088, 0.11, 0.132],
      },
    } as never,
    TEST_ACTOR,
  );

  // A real series, written one day at a time by the real snapshotter — never
  // backfilled (docs/03 §7). Driving the clock rather than inserting rows keeps
  // this honest about how the series actually comes to exist.
  for (let i = 40; i >= 0; i--) {
    const at = NOW - i * DAY;
    c.setNow(at);
    await c.snapshots.run(at);
  }
  c.setNow(NOW);

  return goal;
}

describe('compounding projection', () => {
  it('resolves current and target from the metric, not from stored copies', async () => {
    const goal = await corpusGoal(10_000_000);
    const t = await c.trajectory.forGoal(goal.id, { now: NOW });

    expect(t.projection.available).toBe(true);
    if (!t.projection.available) return;

    expect(t.projection.kind).toBe('compounding');
    expect(t.projection.assumption?.annualRate).toBe(0.11);

    // Every point is a real number, which the `as never` cast could not promise.
    for (const point of t.projection.band) {
      expect(Number.isFinite(point.mid)).toBe(true);
      expect(point.low).toBeLessThanOrEqual(point.mid + 1e-9);
    }
  });

  it('curves, rather than running straight from the current value', async () => {
    const goal = await corpusGoal(10_000_000);
    const t = await c.trajectory.forGoal(goal.id, { now: NOW });
    if (!t.projection.available) throw new Error('expected a projection');

    const climbing = t.projection.band.filter((p) => p.mid < 0.99);
    expect(climbing.length).toBeGreaterThan(3);

    const first = climbing[1]!.mid - climbing[0]!.mid;
    const last = climbing[climbing.length - 1]!.mid - climbing[climbing.length - 2]!.mid;
    // Convexity is the whole point: a linear projection of a corpus fed by
    // contributions *and* returns under-predicts by years (docs/14 Case 2).
    expect(last).toBeGreaterThan(first);
  });

  it('says out loud that the projection rests on an assumption', async () => {
    const goal = await corpusGoal(10_000_000);
    const t = await c.trajectory.forGoal(goal.id, { now: NOW });
    expect(t.caveats.join(' ')).toMatch(/stated return rate, not on observed growth/);
  });

  it('degrades to linear when the metric has no target to compound toward', async () => {
    // Without a denominator there is nothing to compound *toward*, and
    // inventing one is exactly what the engine must never do.
    const goal = await corpusGoal(0);
    await c.repos.metrics.update(
      (await c.repos.metrics.list({ limit: 10 }))[0]!.id,
      { target: null },
      TEST_ACTOR,
    );

    const t = await c.trajectory.forGoal(goal.id, { now: NOW });
    if (!t.projection.available) return;
    expect(t.projection.kind).toBe('linear');
  });
});
