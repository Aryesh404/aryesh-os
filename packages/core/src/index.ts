export { createEventBus } from './events/bus.js';
export type { EventBus, DomainEvents, EventName, Handler } from './events/bus.js';

export { buildGoalInput } from './progress/build-input.js';
export type { BuildOptions } from './progress/build-input.js';

export { createProgressService } from './progress/service.js';
export type { ProgressService, ProgressServiceDeps, GoalProgress } from './progress/service.js';

export { createCollectorRunner } from './collectors/registry.js';
export type { Collector, CollectorRunner, CollectorRunResult } from './collectors/registry.js';
export * from './collectors/builtin.js';

export { createSnapshotter } from './snapshotter/index.js';
export type { Snapshotter, SnapshotResult } from './snapshotter/index.js';

export { createScheduler } from './jobs/scheduler.js';
export type { Scheduler, SchedulerOptions } from './jobs/scheduler.js';

export { createJobQueue } from './jobs/queue.js';
export type { JobQueue, JobHandler, EnqueueOptions } from './jobs/queue.js';

export { createCore, JOB_KINDS } from './create-core.js';
export type { Core, CoreOptions } from './create-core.js';
