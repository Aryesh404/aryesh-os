import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { createServer } from 'vite';
import { appRouter, type AppRouter } from './routers/index.js';
import type { Context } from './trpc.js';
import { createTestApi } from './testing.js';
import { seedReview } from './review-fixtures.js';

// Deliberately separate from index.ts: this entrypoint cannot load DATABASE_URL,
// personal data, production credentials, collectors, or the normal scheduler.
const now = Date.now();
const populated = await createTestApi(now);
const empty = await createTestApi(now);
const fixture = await seedReview(populated, now);
const servers: FastifyInstance[] = [];
for (const [api, port] of [[populated, 4318], [empty, 4319]] as const) {
  const server = Fastify({ routerOptions: { maxParamLength: 5000 } });
  await server.register(cors, { origin: 'http://localhost:5174', credentials: true });
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: (): Context => {
        api.core.setNow(Date.now());
        return {
          db: api.core.db, client: api.core.client, core: api.core, auth: api.auth,
          backupDir: api.backupDir, now: api.core.clock,
          principal: { kind: 'device', id: 'fictional-local-review', scope: 'full' },
          setSessionCookie: () => {}, clearSessionCookie: () => {},
        };
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });
  await server.listen({ host: '127.0.0.1', port });
  servers.push(server);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web');
const web = await createServer({
  root, server: { port: 5174, host: 'localhost', strictPort: true },
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('http://127.0.0.1:4318'),
    'import.meta.env.VITE_REVIEW_EMPTY_API': JSON.stringify('http://127.0.0.1:4319'),
    'import.meta.env.VITE_REVIEW_MODE': JSON.stringify('true'),
    'import.meta.env.VITE_REVIEW_GOAL': JSON.stringify(fixture.goalId),
  },
});
await web.listen();
process.stdout.write('Review: http://localhost:5174\nEmpty: http://localhost:5174/?review=empty#/home\nFictional in-memory data only. Changes last until this process stops.\n');
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await web.close();
  await Promise.all(servers.map((server) => server.close()));
  populated.close(); empty.close();
  process.exit(0);
};
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
