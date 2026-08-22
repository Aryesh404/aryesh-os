import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from '@trpc/server/adapters/fastify';
import { getDb, closeDb } from '@aryesh/db';
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

const app = Fastify({ logger, maxParamLength: 5000 });

// apps/api/src -> repo root. Relative DATABASE_URL values resolve from here,
// so the API opens the same file whether launched by turbo or directly.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const db = getDb({ url: env.DATABASE_URL, root: repoRoot });

await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext: createContextFactory(db),
    onError({ path, error }) {
      app.log.error({ path, code: error.code, err: error.cause }, 'trpc error');
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
});

app.get('/health', () => ({ ok: true }));

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: env.API_PORT, host: env.API_HOST });

export type { AppRouter };
