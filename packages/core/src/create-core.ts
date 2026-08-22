import type { Db } from '@aryesh/db';
import { createRepositories, type Repositories } from '@aryesh/db';
import { createEventBus, type EventBus } from './events/bus.js';
import { createProgressService, type ProgressService } from './progress/service.js';
import { createCollectorRunner, type Collector, type CollectorRunner } from './collectors/registry.js';
import { BUILTIN_COLLECTORS } from './collectors/builtin.js';
import { createSnapshotter, type Snapshotter } from './snapshotter/index.js';
import { createJobQueue, type JobQueue } from './jobs/queue.js';

export interface CoreOptions {
  db: Db;
  /** Injected everywhere, so nothing below the API reads the wall clock. */
  clock?: () => number;
  collectors?: Collector[];
  recordEvents?: boolean;
}

export interface Core {
  db: Db;
  clock: () => number;
  repos: Repositories;
  events: EventBus;
  progress: ProgressService;
  collectors: CollectorRunner;
  snapshots: Snapshotter;
  jobs: JobQueue;
}

/** Job kinds the core registers for itself. */
export const JOB_KINDS = {
  snapshot: 'snapshot.daily',
  collect: 'collector.run',
  recompute: 'progress.recompute',
} as const;

export function createCore(options: CoreOptions): Core {
  const { db } = options;
  const clock = options.clock ?? Date.now;

  const events = createEventBus({ record: options.recordEvents ?? false });
  const repos = createRepositories({ db, clock });
  const progress = createProgressService({ db, clock, events });

  const collectors = createCollectorRunner(
    {
      db,
      clock,
      events,
      recordReading: (input) => repos.readings.record(input, { actor: 'system' }),
    },
    options.collectors ?? BUILTIN_COLLECTORS,
  );

  const snapshots = createSnapshotter({ db, clock, progress, events });
  const jobs = createJobQueue({ db, clock });

  jobs.register(JOB_KINDS.snapshot, async (payload) => {
    const at = typeof payload['at'] === 'number' ? payload['at'] : undefined;
    await snapshots.run(at);
  });

  jobs.register(JOB_KINDS.collect, async (payload) => {
    const key = String(payload['key'] ?? '');
    const now = clock();
    const from = typeof payload['from'] === 'number' ? payload['from'] : now - 86_400_000 * 40;
    const to = typeof payload['to'] === 'number' ? payload['to'] : now;
    if (key === '') await collectors.runAll(from, to);
    else await collectors.run(key, from, to);
  });

  jobs.register(JOB_KINDS.recompute, async (payload) => {
    const goalId = String(payload['goalId'] ?? '');
    if (goalId !== '') await progress.computeAndCache(goalId);
  });

  // A reading changing a metric can only move the goals above it, so the
  // recompute walks up from the metric rather than over everything.
  events.on('reading.recorded', async ({ metricId }) => {
    await progress.recomputeAffectedBy({ kind: 'metric', id: metricId });
  });

  return { db, clock, repos, events, progress, collectors, snapshots, jobs };
}
