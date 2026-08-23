import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { search } from '@aryesh/db';
import { newId, schema } from '@aryesh/db';
import { createTestCore, DAY, TEST_ACTOR, type TestCore } from './testing.js';

/**
 * docs/01 §7 — the budgets, asserted rather than aspired to.
 *
 * Thresholds sit roughly 2–3× above the measured figures on this machine: close
 * enough that an order-of-magnitude regression fails, loose enough that a slow
 * CI box does not produce a flake that gets muted. Measured values are printed
 * in the assertion message, so a failure says how far off it is rather than
 * just that it missed.
 *
 * Measured when written (in-memory libSQL, under vitest):
 *   progress recompute   ~14 ms per goal
 *   nightly snapshot     ~800 ms for 200 goals + 300 metrics
 *   two-year trajectory  ~75 ms
 *   search keystroke     ~12 ms over 5 000 rows
 */

const T0 = 1_700_000_000_000;
let c: TestCore;

beforeEach(async () => {
  c = await createTestCore(T0);
});
afterEach(() => c.close());

const took = async (fn: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await fn();
  return performance.now() - start;
};

/** Bulk insert straight to the tables: the repository path is audited per row,
 *  which is correct for real writes but is not what is being measured. */
async function seedScale(options: {
  goals: number;
  metrics: number;
  readingsPerMetric: number;
  tasks: number;
}) {
  const area = await c.repos.areas.create(
    { name: 'Business', color: '#38bdf8', sortOrder: 0 },
    TEST_ACTOR,
  );

  const base = {
    createdAt: T0,
    updatedAt: T0,
    createdBy: 'user',
    updatedBy: 'user',
    version: 1,
    deletedAt: null,
    customFields: {},
  };

  const metricIds: string[] = [];
  for (let i = 0; i < options.metrics; i += 200) {
    const batch = Array.from(
      { length: Math.min(200, options.metrics - i) },
      (_, j) => {
        const id = newId();
        metricIds.push(id);
        return {
          ...base,
          id,
          key: `metric_${i + j}`,
          name: `Metric ${i + j}`,
          unit: 'count',
          direction: 'increase',
          cadence: 'daily',
          aggregation: 'last',
          source: 'manual',
          bounded: true,
          private: false,
          baseline: 0,
          target: 1000,
        };
      },
    );
    await c.db.insert(schema.metrics).values(batch as never);
  }

  const goalIds: string[] = [];
  for (let i = 0; i < options.goals; i += 200) {
    const batch = Array.from({ length: Math.min(200, options.goals - i) }, (_, j) => {
      const id = newId();
      goalIds.push(id);
      return {
        ...base,
        id,
        areaId: area.id,
        name: `Goal ${i + j}`,
        status: 'active',
        importance: 3,
        measurementMode: 'completion',
        progressModel: { mode: 'metric', metricId: metricIds[(i + j) % metricIds.length] },
        targetDate: T0 + 200 * DAY,
      };
    });
    await c.db.insert(schema.goals).values(batch as never);
  }

  for (const metricId of metricIds) {
    for (let i = 0; i < options.readingsPerMetric; i += 200) {
      const batch = Array.from(
        { length: Math.min(200, options.readingsPerMetric - i) },
        (_, j) => ({
          id: newId(),
          metricId,
          at: T0 - (i + j) * DAY,
          value: 500 + j,
          component: '',
          source: 'collector',
          note: null,
          actor: 'user' as const,
          createdAt: T0,
        }),
      );
      await c.db.insert(schema.readings).values(batch);
    }
  }

  if (options.tasks > 0) {
    for (let i = 0; i < options.tasks; i += 500) {
      const batch = Array.from({ length: Math.min(500, options.tasks - i) }, (_, j) => ({
        ...base,
        id: newId(),
        title: `Task ${i + j} — retainer platform billing flow`,
        status: j % 3 === 0 ? 'done' : 'todo',
      }));
      await c.db.insert(schema.tasks).values(batch as never);
    }
  }

  return { area, goalIds, metricIds };
}

describe('performance budgets (docs/01 §7)', () => {
  it('recomputes one goal well inside the interactive budget', async () => {
    const { goalIds } = await seedScale({
      goals: 200,
      metrics: 100,
      readingsPerMetric: 30,
      tasks: 0,
    });

    // Warm the connection so the first call is not measuring page cache.
    await c.progress.compute(goalIds[0] as string, { now: T0 });

    const elapsed = await took(async () => {
      for (let i = 0; i < 20; i++) {
        await c.progress.compute(goalIds[i] as string, { now: T0 });
      }
    });

    const perGoal = elapsed / 20;
    expect(perGoal, `${perGoal.toFixed(1)}ms per goal`).toBeLessThan(40);
  });

  it('snapshots 200 goals and 300 metrics inside the nightly budget', async () => {
    await seedScale({ goals: 200, metrics: 300, readingsPerMetric: 10, tasks: 0 });

    const elapsed = await took(() => c.snapshots.run(T0));
    // The documented budget itself, now that the per-period query storm is gone.
    expect(elapsed, `${elapsed.toFixed(0)}ms for the nightly run`).toBeLessThan(5_000);
  }, 60_000);

  it('reads two years of daily history for a trajectory chart', async () => {
    const { goalIds } = await seedScale({
      goals: 5,
      metrics: 5,
      readingsPerMetric: 5,
      tasks: 0,
    });
    const goalId = goalIds[0] as string;

    // 730 daily snapshots — the widest window the chart ever draws.
    for (let day = 0; day < 730; day += 200) {
      const batch = Array.from({ length: Math.min(200, 730 - day) }, (_, j) => ({
        id: newId(),
        goalId,
        date: T0 - (day + j) * DAY,
        mode: 'completion' as const,
        progress: (730 - day - j) / 730,
        momentum: null,
        confidence: 0.8,
        degradedReason: null,
        breakdown: [],
        velocity7d: null,
        velocity30d: null,
        createdAt: T0,
      }));
      await c.db.insert(schema.goalSnapshots).values(batch);
    }

    const elapsed = await took(() =>
      c.trajectory.forGoal(goalId, { now: T0, windowDays: 730 }),
    );
    expect(elapsed, `${elapsed.toFixed(0)}ms for a two-year trajectory`).toBeLessThan(300);
  }, 60_000);

  it('pages a large table by keyset without slowing down', async () => {
    await seedScale({ goals: 20, metrics: 20, readingsPerMetric: 5, tasks: 20_000 });

    const first = await c.repos.tasks.list({ limit: 50 });
    const early = await took(() => c.repos.tasks.list({ limit: 50 }));

    const last = first[first.length - 1];
    const deep = await took(() =>
      c.repos.tasks.list({
        limit: 50,
        after: { updatedAt: last?.updatedAt as number, id: last?.id as string },
      }),
    );

    expect(early, `${early.toFixed(0)}ms for the first page`).toBeLessThan(250);
    expect(deep, `${deep.toFixed(0)}ms for a later page`).toBeLessThan(250);
  }, 60_000);

  it('answers a command-palette keystroke fast enough to feel instant', async () => {
    await seedScale({ goals: 50, metrics: 50, readingsPerMetric: 5, tasks: 5_000 });

    await search(c.db, 'retainer');
    const elapsed = await took(async () => {
      for (const query of ['ret', 'reta', 'retai', 'retain']) {
        await search(c.db, query, { limit: 20 });
      }
    });

    const perKeystroke = elapsed / 4;
    expect(perKeystroke, `${perKeystroke.toFixed(1)}ms per keystroke`).toBeLessThan(40);
  }, 60_000);
});
