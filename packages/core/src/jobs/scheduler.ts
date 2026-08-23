import { startOfUtcDay } from '@aryesh/intelligence';
import type { Core } from '../create-core.js';
import { JOB_KINDS } from '../create-core.js';

/**
 * Turns the durable queue into something that actually fires.
 *
 * Deliberately not cron syntax: there are two schedules, and a cron parser
 * would be a dependency plus a configuration surface for a decision that is
 * "nightly" and "hourly" (design rule 6).
 */
export interface SchedulerOptions {
  /** How often to look for due work. */
  tickMs?: number;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Runs one tick immediately. Exposed for tests and manual triggers. */
  tick(): Promise<void>;
}

export function createScheduler(core: Core, options: SchedulerOptions = {}): Scheduler {
  const tickMs = options.tickMs ?? 60_000;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<void> => {
    const now = core.clock();
    const today = startOfUtcDay(now);

    /**
     * Today's snapshot only, deduped by date. Days the app was closed stay
     * empty on purpose.
     *
     * Back-filling them would stamp *today's* computed progress onto past
     * dates, because progress is derived from the readings that exist now — so
     * a user who backfills six months of revenue on Monday would get a week of
     * invented history showing Monday's figure. A gap in the series is honest;
     * fabricated points are not, and they are indistinguishable from real ones
     * once written (docs/03 §7).
     */
    await core.jobs.enqueue(
      JOB_KINDS.snapshot,
      { at: now },
      { dedupeKey: `snapshot:${today}` },
    );

    await core.jobs.enqueue(
      JOB_KINDS.collect,
      {},
      { dedupeKey: `collect:${today}` },
    );

    await core.jobs.drain();
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      // Do not hold the process open on this alone.
      timer.unref?.();
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}
