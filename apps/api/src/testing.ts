import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestCore, type TestCore } from '@aryesh/core/testing';
import { ensureSearchIndex } from '@aryesh/db';
import { createAuthService, type AuthService, type Principal } from './auth/service.js';
import { appRouter } from './routers/index.js';
import type { Context } from './trpc.js';

export interface TestApi {
  core: TestCore;
  auth: AuthService;
  /** Where this instance writes binary snapshots. */
  backupDir: string;
  /** A caller with no credential, for testing the auth boundary itself. */
  anonymous: ReturnType<typeof appRouter.createCaller>;
  /** A caller at the given scope, bypassing the cookie round-trip. */
  as: (scope: 'read' | 'capture' | 'full') => ReturnType<typeof appRouter.createCaller>;
  cookies: string[];
  close: () => void;
}

export async function createTestApi(startAt = 1_700_000_000_000): Promise<TestApi> {
  const core = await createTestCore(startAt);
  await ensureSearchIndex(core.db);
  const auth = createAuthService({ db: core.db, clock: core.clock });
  const cookies: string[] = [];
  const backupDir = mkdtempSync(join(tmpdir(), 'aryesh-test-backups-'));

  const context = (principal: Principal | null): Context => ({
    db: core.db,
    client: core.client,
    core,
    backupDir,
    auth,
    now: core.clock,
    principal,
    setSessionCookie: (token) => {
      cookies.push(token);
    },
    clearSessionCookie: () => {
      cookies.length = 0;
    },
  });

  return {
    core,
    auth,
    backupDir,
    cookies,
    anonymous: appRouter.createCaller(context(null)),
    as: (scope) =>
      appRouter.createCaller(
        context({ kind: scope === 'full' ? 'session' : 'device', id: 'test', scope }),
      ),
    close: () => {
      core.close();
      rmSync(backupDir, { recursive: true, force: true });
    },
  };
}
