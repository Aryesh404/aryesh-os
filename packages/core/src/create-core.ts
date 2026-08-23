import type { Db } from '@aryesh/db';
import type { Client } from '@libsql/client';
import { createRepositories, pruneBackups, snapshotDatabase, type Repositories } from '@aryesh/db';
import { createEventBus, type EventBus } from './events/bus.js';
import { createProgressService, type ProgressService } from './progress/service.js';
import { createCollectorRunner, type Collector, type CollectorRunner } from './collectors/registry.js';
import { BUILTIN_COLLECTORS } from './collectors/builtin.js';
import { createSnapshotter, type Snapshotter } from './snapshotter/index.js';
import { createTrajectoryService, type TrajectoryService } from './trajectory/service.js';
import { createJobQueue, type JobQueue } from './jobs/queue.js';

export interface CoreOptions {
  db: Db;
  /** Raw client, for VACUUM INTO. Backups are skipped without it. */
  client?: Client;
  /** Where binary snapshots are written. Backups are skipped without it. */
  backupDir?: string;
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
  trajectory: TrajectoryService;
  jobs: JobQueue;
}

/** Job kinds the core registers for itself. */
export const JOB_KINDS = {
  snapshot: 'snapshot.daily',
  collect: 'collector.run',
  recompute: 'progress.recompute',
  backup: 'backup.daily',
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
  const trajectory = createTrajectoryService({ db, clock });
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

  // Nightly binary snapshot with tiered retention (docs/09 §7). Skipped when
  // the core is built without a client — tests and the pure paths do not need
  // to write files.
  if (options.client && options.backupDir) {
    const { client, backupDir } = options;
    jobs.register(JOB_KINDS.backup, async () => {
      const stamp = new Date(clock()).toISOString().replace(/[:.]/g, '-');
      await snapshotDatabase(client, `${backupDir}/aryesh-${stamp}.db`);
      pruneBackups(backupDir, clock());
    });
  }

  jobs.register(JOB_KINDS.recompute, async (payload) => {
    const goalId = String(payload['goalId'] ?? '');
    if (goalId !== '') await progress.computeAndCache(goalId);
  });

  // A reading changing a metric can only move the goals above it, so the
  // recompute walks up from the metric rather than over everything.
  events.on('reading.recorded', async ({ metricId }) => {
    await progress.recomputeAffectedBy({ kind: 'metric', id: metricId });
  });

  // Closing a task moves its project, which may move goals above it — but only
  // through an explicit weighted contribution (docs/03 §4.4).
  events.on('task.changed', async ({ projectId }) => {
    if (projectId === undefined) return;
    await progress.recomputeProject(projectId);
    await progress.recomputeAffectedBy({ kind: 'project', id: projectId });
  });

  return { db, clock, repos, events, progress, collectors, snapshots, trajectory, jobs };
}
