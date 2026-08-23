import { createTestCore, type TestCore } from '@aryesh/core/testing';
import { ensureSearchIndex } from '@aryesh/db';
import { createAuthService, type AuthService, type Principal } from './auth/service.js';
import { appRouter } from './routers/index.js';
import type { Context } from './trpc.js';

export interface TestApi {
  core: TestCore;
  auth: AuthService;
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

  const context = (principal: Principal | null): Context => ({
    db: core.db,
    core,
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
    cookies,
    anonymous: appRouter.createCaller(context(null)),
    as: (scope) =>
      appRouter.createCaller(
        context({ kind: scope === 'full' ? 'session' : 'device', id: 'test', scope }),
      ),
    close: () => core.close(),
  };
}
