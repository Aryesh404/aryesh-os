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
  /** Catch up on nights the app was closed, up to this many days back. */
  catchUpDays?: number;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Runs one tick immediately. Exposed for tests and manual triggers. */
  tick(): Promise<void>;
}

export function createScheduler(core: Core, options: SchedulerOptions = {}): Scheduler {
  const tickMs = options.tickMs ?? 60_000;
  const catchUpDays = options.catchUpDays ?? 7;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<void> => {
    const now = core.clock();
    const today = startOfUtcDay(now);

    // One snapshot per day, deduped by date. Closing the laptop for a week
    // leaves seven distinct days to fill, not seven copies of tonight's job.
    for (let back = 0; back < catchUpDays; back++) {
      const date = today - back * 86_400_000;
      await core.jobs.enqueue(
        JOB_KINDS.snapshot,
        { at: date + 23 * 3_600_000 },
        { dedupeKey: `snapshot:${date}` },
      );
    }

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
