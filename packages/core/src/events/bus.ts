/**
 * docs/01 §6 — one typed in-process bus. The progress engine, snapshotter, and
 * cache invalidation subscribe to it rather than calling each other, which is
 * what stops those subsystems fusing into a ball of mud.
 *
 * It is also the seam automations arrive through in Phase 4 (docs/08 §4): the
 * workflow engine becomes one more subscriber, with no upstream change.
 */

export interface DomainEvents {
  'reading.recorded': { metricId: string; at: number; value: number };
  'goal.changed': { goalId: string; reason: 'model' | 'contributors' | 'status' };
  'progress.recomputed': { goalId: string; progress: number | null; confidence: number };
  'project.changed': { projectId: string };
  'task.changed': { taskId: string; projectId?: string | undefined };
  'snapshot.written': { date: number; goals: number; metrics: number };
  'collector.ran': { key: string; periods: number; written: number };
  'config.changed': { subjectType: string; subjectId: string };
}

export type EventName = keyof DomainEvents;
export type Handler<K extends EventName> = (payload: DomainEvents[K]) => void | Promise<void>;

export interface EventBus {
  on<K extends EventName>(event: K, handler: Handler<K>): () => void;
  emit<K extends EventName>(event: K, payload: DomainEvents[K]): Promise<void>;
  /** Test affordance: what was emitted, in order. */
  readonly emitted: ReadonlyArray<{ event: EventName; payload: unknown }>;
}

export interface EventBusOptions {
  /** Called when a subscriber throws. A bad subscriber must not fail the write. */
  onError?: (event: EventName, error: unknown) => void;
  /** Keep an in-memory log. Off outside tests. */
  record?: boolean;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const handlers = new Map<EventName, Set<Handler<EventName>>>();
  const emitted: Array<{ event: EventName; payload: unknown }> = [];

  return {
    emitted,

    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler as Handler<EventName>);
      handlers.set(event, set);
      return () => {
        set.delete(handler as Handler<EventName>);
      };
    },

    async emit(event, payload) {
      if (options.record) emitted.push({ event, payload });
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of set) {
        try {
          await handler(payload as never);
        } catch (error) {
          // A subscriber failing must never roll back the thing that happened.
          options.onError?.(event, error);
        }
      }
    },
  };
}
