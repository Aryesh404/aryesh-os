import { initTRPC, TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify';
import { AppError, type ErrorCode } from '@aryesh/contracts';
import type { Db } from '@aryesh/db';

export interface Context {
  db: Db;
  /** Wall clock, injected so handlers stay testable (docs/11 conventions). */
  now: () => number;
}

export function createContextFactory(db: Db) {
  return (_opts: CreateFastifyContextOptions): Context => ({
    db,
    now: () => Date.now(),
  });
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
