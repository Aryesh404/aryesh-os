import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exportAll,
  importAll,
  listBackups,
  pruneBackups,
  snapshotDatabase,
  validateExport,
  type ExportPayload,
} from './backup.js';
import { createTestDb, TEST_ACTOR, type TestDb } from './testing.js';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

let t: TestDb;
let workspace: string;

beforeEach(async () => {
  t = await createTestDb(T0);
  workspace = mkdtempSync(join(tmpdir(), 'aryesh-backup-'));
});
afterEach(() => {
  t.close();
  rmSync(workspace, { recursive: true, force: true });
});

async function seed() {
  const area = await t.repos.areas.create(
    { name: 'Business', color: '#38bdf8', sortOrder: 0 },
    TEST_ACTOR,
  );
  const metric = await t.repos.metrics.create(
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
  const goal = await t.repos.goals.create(
    {
      areaId: area.id,
      name: '₹5L MRR by March 2027',
      why: 'Recurring revenue changes the shape of the business.',
      progressModel: { mode: 'metric', metricId: metric.id },
    },
    TEST_ACTOR,
  );
  await t.repos.readings.record(
    { metricId: metric.id, at: T0, value: 140_000 },
    TEST_ACTOR,
  );
  return { area, metric, goal };
}

describe('export', () => {
  it('carries the user data, with counts and checksums', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);

    expect(payload.manifest.schemaVersion).toBe(1);
    expect(payload.manifest.exportedAt).toBe(T0);
    expect(payload.manifest.counts['goals']).toBe(1);
    expect(payload.manifest.counts['readings']).toBe(1);
    expect(payload.manifest.checksums['goals']).toHaveLength(64);
    expect(payload.tables['goals']).toHaveLength(1);
  });

  /**
   * A leaked export should not leak the account. Secrets and machine-local
   * bookkeeping stay in the binary snapshot, which never leaves the machine
   * casually.
   */
  it('never carries credentials, sessions, or device tokens', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);

    for (const table of ['credentials', 'sessions', 'passkeys', 'device_tokens']) {
      expect(payload.tables[table], table).toBeUndefined();
      expect(payload.manifest.excluded).toContain(table);
    }

    expect(JSON.stringify(payload)).not.toMatch(/argon2/);
  });

  it('is readable JSON rather than an opaque blob', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);
    const text = JSON.stringify(payload);

    expect(text).toContain('₹5L MRR by March 2027');
    expect(text).toContain('Recurring revenue changes the shape of the business.');
  });
});

describe('validation', () => {
  it('accepts its own export', async () => {
    await seed();
    expect(validateExport(await exportAll(t.db, T0))).toEqual({ valid: true });
  });

  it('detects an altered file', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);
    (payload.tables['goals'] as Array<{ name: string }>)[0]!.name = 'tampered';

    const result = validateExport(payload);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.problems[0]).toMatch(/does not match its checksum/);
  });

  it('refuses an export from a different schema version', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);
    payload.manifest.schemaVersion = 99;

    const result = validateExport(payload);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.problems[0]).toMatch(/schema version 99/);
  });

  it('rejects something that is not an export at all', () => {
    const result = validateExport({ hello: 'world' } as unknown as ExportPayload);
    expect(result.valid).toBe(false);
  });
});

describe('round trip', () => {
  it('restores into an empty database exactly', async () => {
    const seeded = await seed();
    const payload = await exportAll(t.db, T0);

    const fresh = await createTestDb(T0);
    try {
      const result = await importAll(fresh.client, payload);
      expect(result.rows).toBeGreaterThan(0);

      const goal = await fresh.repos.goals.getById(seeded.goal.id);
      expect(goal.name).toBe('₹5L MRR by March 2027');
      expect(goal.progressModel).toEqual({ mode: 'metric', metricId: seeded.metric.id });

      expect(await fresh.repos.readings.count(seeded.metric.id)).toBe(1);

      // Re-exporting the restored database reproduces the same checksums.
      const again = await exportAll(fresh.db, T0);
      expect(again.manifest.checksums).toEqual(payload.manifest.checksums);
    } finally {
      fresh.close();
    }
  });

  it('replaces existing content rather than merging into it', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);

    const other = await createTestDb(T0);
    try {
      await other.repos.areas.create(
        { name: 'Should be gone', color: '#fff', sortOrder: 0 },
        TEST_ACTOR,
      );
      await importAll(other.client, payload);

      const areas = await other.repos.areas.list({});
      expect(areas.map((a) => a.name)).toEqual(['Business']);
    } finally {
      other.close();
    }
  });

  it('refuses a tampered export before writing anything', async () => {
    await seed();
    const payload = await exportAll(t.db, T0);
    (payload.tables['goals'] as Array<{ name: string }>)[0]!.name = 'tampered';

    const other = await createTestDb(T0);
    try {
      await other.repos.areas.create(
        { name: 'Untouched', color: '#fff', sortOrder: 0 },
        TEST_ACTOR,
      );
      await expect(importAll(other.client, payload)).rejects.toThrow(/refusing to import/);

      // The failure left the database exactly as it was.
      const areas = await other.repos.areas.list({});
      expect(areas.map((a) => a.name)).toEqual(['Untouched']);
    } finally {
      other.close();
    }
  });
});

describe('binary snapshots', () => {
  it('writes a consistent copy without stopping the app', async () => {
    await seed();
    const target = join(workspace, 'aryesh-001.db');
    const backup = await snapshotDatabase(t.client, target);

    expect(backup.bytes).toBeGreaterThan(0);
    expect(listBackups(workspace).map((b) => b.path)).toContain(backup.path);
  });

  it('keeps recent, daily, then weekly, and drops the rest', () => {
    const now = T0;
    const write = (name: string, at: number): void => {
      const path = join(workspace, name);
      writeFileSync(path, 'x');
      // utimesSync takes seconds.
      // eslint-disable-next-line
      require('node:fs').utimesSync(path, at / 1000, at / 1000);
    };

    write('aryesh-recent-a.db', now - 1 * 3_600_000);
    write('aryesh-recent-b.db', now - 5 * 3_600_000);
    write('aryesh-day3-a.db', now - 3 * DAY);
    write('aryesh-day3-b.db', now - 3 * DAY - 3_600_000);
    write('aryesh-old-a.db', now - 40 * DAY);
    write('aryesh-old-b.db', now - 41 * DAY);

    pruneBackups(workspace, now);
    const kept = listBackups(workspace).map((b) => b.path.split(/[\\/]/).pop());

    // Both from today survive; only one of each older day and week.
    expect(kept).toContain('aryesh-recent-a.db');
    expect(kept).toContain('aryesh-recent-b.db');
    expect(kept.filter((n) => n?.startsWith('aryesh-day3')).length).toBe(1);
    expect(kept.filter((n) => n?.startsWith('aryesh-old')).length).toBeLessThanOrEqual(2);
  });

  it('reports no backups for a directory that does not exist', () => {
    expect(listBackups(join(workspace, 'nope'))).toEqual([]);
  });
});
