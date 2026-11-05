import { Icon } from '../../components/icon.js';
import { ErrorNote } from '../../components/ui.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { useQueryClient } from '@tanstack/react-query';
import { saveTask } from '../../lib/daily-cache.js';

export type TaskRow = Awaited<ReturnType<typeof trpc.tasks.browse.query>>['items'][number];
export function TaskCheck({ task }: { task: TaskRow }) {
  const client = useQueryClient();
  const toggle = useApiMutation((done: boolean) => trpc.tasks.update.mutate({
    id: task.id, expectedVersion: task.version,
    patch: { status: done ? 'todo' : 'done', completedAt: done ? null : Date.now(),
      ...(!done && task.startedAt === null ? { startedAt: Date.now() } : {}),
    },
  }), {
    record: { key: keys.tasks },
    invalidates: [keys.today, keys.tasks, keys.projects, keys.goals],
    onSuccess: (saved) => saveTask(client, saved),
  });
  const done = toggle.isPending ? !toggle.variables : task.status === 'done';
  return <div className="shrink-0">
    <button className="check-button" aria-pressed={done} aria-busy={toggle.isPending} aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`} disabled={toggle.isPending} onClick={() => toggle.mutate(task.status === 'done')}>
      <span className="check-shape">{done && <Icon name="check" size={14} />}</span>
    </button>
    {toggle.isPending && <span className="row-meta block" role="status">Saving…</span>}
    {toggle.isError && <div className="max-w-40"><ErrorNote error={toggle.error} /></div>}
  </div>;
}
