import { createTestDb, TEST_ACTOR, type TestDb } from '@aryesh/db/testing';
import { createCore, type Core } from './create-core.js';

export interface TestCore extends Core {
  /** The raw client, for VACUUM INTO and batched restores. */
  client: TestDb['client'];
  setNow: (ms: number) => void;
  close: () => void;
}

/**
 * Real libSQL, real migrations, controllable clock. Nothing here is mocked —
 * for a system whose whole job is time-ordered data, a fake clock is the only
 * fake worth having.
 */
export async function createTestCore(startAt = 1_700_000_000_000): Promise<TestCore> {
  const test: TestDb = await createTestDb(startAt);
  const core = createCore({ db: test.db, clock: test.now, recordEvents: true });
  return { ...core, client: test.client, setNow: test.setNow, close: test.close };
}

export { TEST_ACTOR };
export const DAY = 86_400_000;
