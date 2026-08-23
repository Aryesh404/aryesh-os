import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApi, type TestApi } from '../testing.js';

const T0 = 1_700_000_000_000;
let api: TestApi;

beforeEach(async () => {
  api = await createTestApi(T0);
});
afterEach(() => api.close());

const full = () => api.as('full');

async function seed() {
  const caller = full();
  const area = await caller.areas.create({ name: 'Business', color: '#38bdf8' });
  const metric = await caller.metrics.create({
    key: 'monthly_revenue',
    name: 'Monthly revenue',
    unit: 'currency',
    direction: 'increase',
    cadence: 'monthly',
    source: 'manual',
    baseline: 0,
    target: 500_000,
  });
  const goal = await caller.goals.create({
    areaId: area.id,
    name: '₹5L MRR by March 2027',
    progressModel: { mode: 'metric', metricId: metric.id },
  });
  await caller.readings.record({ metricId: metric.id, at: T0, value: 140_000 });
  return { area, metric, goal };
}

describe('export', () => {
  it('hands back readable data with a manifest', async () => {
    await seed();
    const payload = await full().data.export();

    expect(payload.manifest.schemaVersion).toBe(1);
    expect(payload.manifest.counts['goals']).toBe(1);
    expect(JSON.stringify(payload)).toContain('₹5L MRR by March 2027');
  });

  /** A phone that can record a reading should not be able to pull everything. */
  it('needs full scope, not capture', async () => {
    await seed();
    await expect(api.as('capture').data.export()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(api.anonymous.data.export()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('backups', () => {
  it('creates a snapshot and lists it', async () => {
    await seed();
    expect(await full().data.backups.list()).toHaveLength(0);

    const backup = await full().data.backups.create();
    expect(backup.bytes).toBeGreaterThan(0);

    const listed = await full().data.backups.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.path).toBe(backup.path);
  });
});

describe('import', () => {
  it('refuses without the typed confirmation', async () => {
    await seed();
    const payload = await full().data.export();

    await expect(
      // @ts-expect-error the literal is the point — a wrong string must not compile
      full().data.import({ payload, confirm: 'yes' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('validates without touching anything', async () => {
    await seed();
    const payload = await full().data.export();

    expect(await full().data.validateImport({ payload })).toEqual({ valid: true });

    (payload.tables['goals'] as Array<{ name: string }>)[0]!.name = 'tampered';
    const result = await full().data.validateImport({ payload });
    expect(result.valid).toBe(false);
  });

  /**
   * The one operation where "are you sure?" is not enough, because the answer
   * is only discoverable afterwards.
   */
  it('takes a safety snapshot before replacing anything', async () => {
    const seeded = await seed();
    const payload = await full().data.export();

    await full().areas.create({ name: 'Added later', color: '#fff' });

    const result = await full().data.import({
      payload,
      confirm: 'replace everything',
    });

    expect(result.rows).toBeGreaterThan(0);
    expect(result.revertTo).toMatch(/aryesh-before-import-/);

    // The export's world replaced the current one.
    const areas = await full().areas.list({});
    expect(areas.items.map((a) => a.name)).toEqual(['Business']);

    const goal = await full().goals.byId({ id: seeded.goal.id });
    expect(goal.name).toBe('₹5L MRR by March 2027');
  });

  it('rejects a tampered export and leaves the database alone', async () => {
    await seed();
    const payload = await full().data.export();
    (payload.tables['goals'] as Array<{ name: string }>)[0]!.name = 'tampered';

    await expect(
      full().data.import({ payload, confirm: 'replace everything' }),
    ).rejects.toThrow(/refusing to import/);

    const goals = await full().goals.list({});
    expect(goals.items[0]?.name).toBe('₹5L MRR by March 2027');
  });
});
