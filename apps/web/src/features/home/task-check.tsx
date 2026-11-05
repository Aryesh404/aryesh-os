import { Icon } from '../../components/icon.js';
import { ErrorNote } from '../../components/ui.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

export type TaskRow = Awaited<ReturnType<typeof trpc.tasks.browse.query>>['items'][number];
export function TaskCheck({ task }: { task: TaskRow }) {
  const done = task.status === 'done';
  const toggle = useApiMutation(() => trpc.tasks.update.mutate({
    id: task.id, expectedVersion: task.version,
    patch: { status: done ? 'todo' : 'done', completedAt: done ? null : Date.now(),
      ...(!done && task.startedAt === null ? { startedAt: Date.now() } : {}),
    },
  }), { invalidates: [keys.today, keys.tasks, keys.projects, keys.goals] });
  return <div className="shrink-0">
    <button className="check-button" aria-pressed={done} aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} disabled={toggle.isPending} onClick={() => toggle.mutate(undefined)}>
      <span className="check-shape">{done && <Icon name="check" size={14} />}</span>
    </button>
    {toggle.isError && <div className="max-w-40"><ErrorNote error={toggle.error} /></div>}
  </div>;
}
