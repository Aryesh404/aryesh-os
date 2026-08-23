// Pulls in @fastify/cookie's declaration merging for reply.setCookie.
import type {} from '@fastify/cookie';
import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { AppError, type ErrorCode } from '@aryesh/contracts';
import type { Client } from '@libsql/client';
import type { Db } from '@aryesh/db';
import type { Core } from '@aryesh/core';
import type { AuthService, DeviceScope, Principal } from './auth/service.js';

export const SESSION_COOKIE = 'aos_session';

export interface Context {
  db: Db;
  /** The raw client, for VACUUM INTO and batched restores. */
  client: Client;
  core: Core;
  /** Where binary snapshots live. Resolved from the repo root, not cwd. */
  backupDir: string;
  auth: AuthService;
  /** Wall clock, injected so handlers stay testable (docs/11 conventions). */
  now: () => number;
  /** Null when the request carried no valid credential. */
  principal: Principal | null;
  setSessionCookie: (token: string, expiresAt: number) => void;
  clearSessionCookie: () => void;
}

export interface ContextDeps {
  db: Db;
  client: Client;
  core: Core;
  auth: AuthService;
  backupDir: string;
  secureCookies: boolean;
}

export function createContextFactory(deps: ContextDeps) {
  return async ({ req, res }: CreateFastifyContextOptions): Promise<Context> => {
    const principal = await resolvePrincipal(deps.auth, req);

    return {
      db: deps.db,
      client: deps.client,
      core: deps.core,
      backupDir: deps.backupDir,
      auth: deps.auth,
      now: deps.core.clock,
      principal,
      setSessionCookie(token, expiresAt) {
        void res.setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: 'lax',
          secure: deps.secureCookies,
          path: '/',
          expires: new Date(expiresAt),
        });
      },
      clearSessionCookie() {
        void res.clearCookie(SESSION_COOKIE, { path: '/' });
      },
    };
  };
}

async function resolvePrincipal(
  auth: AuthService,
  req: CreateFastifyContextOptions['req'],
): Promise<Principal | null> {
  // A device token is explicit and scoped, so it wins over an ambient cookie
  // when both happen to be present.
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return auth.resolveDeviceToken(header.slice(7).trim());
  }

  const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[
    SESSION_COOKIE
  ];
  if (cookie !== undefined) return auth.resolveSession(cookie);

  return null;
}

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (cause instanceof AppError) {
      return {
        ...shape,
        data: { ...shape.data, appCode: cause.code, details: cause.details },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const mergeRouters = t.mergeRouters;
export const middleware = t.middleware;

/**
 * "This cannot be measured yet" is a legitimate answer, not a server fault.
 * Domain errors carry their own HTTP semantics rather than defaulting to 500.
 */
const HTTP_FOR: Record<ErrorCode, TRPC_ERROR_CODE_KEY> = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_MEASURABLE: 'UNPROCESSABLE_CONTENT',
  CYCLE_DETECTED: 'BAD_REQUEST',
  INTERNAL: 'INTERNAL_SERVER_ERROR',
};

// `next()` resolves with a result object rather than throwing, so downstream
// errors are inspected here, not caught.
const mapDomainErrors = t.middleware(async ({ next }) => {
  const result = await next();
  if (!result.ok) {
    const cause = result.error.cause;
    if (cause instanceof AppError) {
      throw new TRPCError({
        code: HTTP_FOR[cause.code],
        message: cause.message,
        cause,
      });
    }
  }
  return result;
});

export const publicProcedure = t.procedure.use(mapDomainErrors);

const SCOPE_RANK: Record<DeviceScope, number> = { read: 0, capture: 1, full: 2 };

/**
 * A session is always `full`; a device token carries whatever scope it was
 * issued with, so a phone that can capture readings cannot also delete a goal.
 */
const requireScope = (minimum: DeviceScope) =>
  t.middleware(async ({ ctx, next }) => {
    if (ctx.principal === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'sign in required' });
    }
    if (SCOPE_RANK[ctx.principal.scope] < SCOPE_RANK[minimum]) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `this needs '${minimum}' access; this credential has '${ctx.principal.scope}'`,
      });
    }
    return next({ ctx: { ...ctx, principal: ctx.principal } });
  });

/** Read-only. The lowest bar any credential clears. */
export const protectedProcedure = publicProcedure.use(requireScope('read'));

/** Recording observations: readings, tasks, notes. What a phone needs. */
export const captureProcedure = publicProcedure.use(requireScope('capture'));

/** Structural change: goals, models, deletion, credentials. */
export const fullProcedure = publicProcedure.use(requireScope('full'));

/**
 * Every mutation carries an actor; there is no anonymous write. Today there is
 * one human, so every authenticated principal writes as `user`; agent writes
 * arrive in Phase 5 with their own actor and execution id.
 */
export function actorOf(_ctx: Context): { actor: 'user' } {
  return { actor: 'user' };
}
