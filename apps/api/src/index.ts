import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from '@trpc/server/adapters/fastify';
import { AppError } from '@aryesh/contracts';
import { configureConnection, createDb, ensureSearchIndex } from '@aryesh/db';
import { createCore, createScheduler } from '@aryesh/core';
import { createAuthService } from './auth/service.js';
import { loadEnv } from './env.js';
import { appRouter, type AppRouter } from './routers/index.js';
import { createContextFactory } from './trpc.js';

const env = loadEnv();

const logger =
  env.NODE_ENV === 'development'
    ? {
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level: env.NODE_ENV === 'production' ? 'info' : 'silent' };

// tRPC batches queries into the URL, so the default 100-char limit is too
// small. `maxParamLength` at the top level is deprecated in Fastify 5.
const app = Fastify({
  logger,
  routerOptions: { maxParamLength: 5000 },
  // One id per request, echoed in the response, so a log line and a thing the
  // user saw can be matched up after the fact.
  genReqId: () => randomUUID(),
});

app.addHook('onSend', async (request, reply) => {
  void reply.header('x-request-id', String(request.id));
});

/**
 * `npm run dev` starts this with cwd = apps/api, so a relative DATABASE_URL
 * would resolve to apps/api/data rather than the repository's data directory.
 * The root is derived from this file's own location instead of the process's.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { db, client } = createDb({ url: env.DATABASE_URL, root: repoRoot });
await configureConnection(client, env.DATABASE_URL);
const backupDir = resolve(repoRoot, 'data/backups');
await ensureSearchIndex(db);

const core = createCore({ db, client, backupDir });
const auth = createAuthService({ db, clock: core.clock });

await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
await app.register(cookie);

await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext: createContextFactory({
      db,
      client,
      core,
      auth,
      backupDir,
      // Loopback in development; a tunnel terminates TLS in front of this.
      secureCookies: env.NODE_ENV === 'production',
    }),
    onError({ path, error, req }) {
      const cause = error.cause;
      const appCode = cause instanceof AppError ? cause.code : undefined;

      // A refusal is not a fault. "This cannot be measured yet" and "sign in
      // required" are answers, and logging them as errors trains the reader to
      // ignore the log.
      const expected =
        appCode !== undefined && appCode !== 'INTERNAL' && appCode !== 'CONFLICT';

      const line = { reqId: req.id, path, code: error.code, appCode };
      if (expected) app.log.info(line, 'request refused');
      else app.log.error({ ...line, err: cause ?? error }, 'request failed');
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
});

app.get('/health', () => ({ ok: true }));

/**
 * Snapshots and collectors run on a timer inside the API process. There is no
 * separate worker: one user, one machine, and a missed night is a permanent
 * hole in the trajectory, so the scheduler catches up rather than skipping.
 */
const scheduler = createScheduler(core);
scheduler.start();

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  scheduler.stop();
  await app.close();
  client.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.API_PORT, host: env.API_HOST });

export type { AppRouter };
