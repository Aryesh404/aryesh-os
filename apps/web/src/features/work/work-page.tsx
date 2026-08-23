import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Input, Select, Skeleton, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

/**
 * Projects, tasks, and habits.
 *
 * Task completion is *activity*. It rolls up into a project, and a project
 * reaches a goal only through an explicit weighted contribution — there is no
 * task→goal path anywhere in the model (docs/03 §4.4).
 */

const BASIS_LABEL: Record<string, string> = {
  task_based: 'tasks closed (activity proxy)',
  milestone: 'deliverables',
  manual: 'stated by hand',
  outcome: 'an outcome metric',
};

export function WorkPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold m-0">Work</h1>
        <Subtle>Projects and habits. Activity, which becomes advancement only where you say so.</Subtle>
      </header>
      <Projects />
      <Habits />
    </div>
  );
}

function Projects() {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const projects = useApi(keys.projects, () => trpc.projects.list.query({ limit: 100 }));
  const create = useApiMutation(
    () => trpc.projects.create.mutate({ name, status: 'active' }),
    { invalidates: [keys.projects], onSuccess: () => setName('') },
  );

  return (
    <Card title="Projects">
      {projects.isPending && <Skeleton className="h-16 w-full" />}
      {projects.data?.items.length === 0 && <Empty title="No projects yet" />}

      <ul className="list-none p-0 m-0 space-y-2">
        {(projects.data?.items ?? []).map((project) => (
          <li key={project.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
            <button
              onClick={() => setSelected(selected === project.id ? null : project.id)}
              className="w-full text-left flex items-center gap-3"
            >
              <span className="flex-1">{project.name}</span>
              <Subtle>
                progress from {BASIS_LABEL[project.progressBasis.mode] ?? project.progressBasis.mode}
              </Subtle>
              <span className="mono text-[13px] text-fg-muted">
                {project.progress === null ? '—' : `${Math.round(project.progress * 100)}%`}
              </span>
            </button>
            {selected === project.id && <Tasks projectId={project.id} />}
          </li>
        ))}
      </ul>

      <form
        className="mt-4 pt-3 border-t border-line flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined as never);
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project…" />
        <Button type="submit" disabled={name.trim() === ''}>Add</Button>
      </form>
      {create.isError && <ErrorNote error={create.error} />}
    </Card>
  );
}

function Tasks({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');

  const tasks = useApi(keys.tasks, () => trpc.tasks.list.query({ limit: 200 }));
  const invalidates = [keys.tasks, keys.projects, keys.goals];

  const create = useApiMutation(
    () =>
      trpc.tasks.create.mutate({
        projectId,
        title,
        status: 'todo',
        ...(estimate !== '' ? { estimate: Number(estimate) } : {}),
      }),
    { invalidates, onSuccess: () => { setTitle(''); setEstimate(''); } },
  );

  const toggle = useApiMutation(
    (input: { id: string; done: boolean }) =>
      trpc.tasks.update.mutate({
        id: input.id,
        patch: {
          status: input.done ? 'done' : 'todo',
          completedAt: input.done ? Date.now() : null,
          ...(input.done ? { startedAt: Date.now() } : {}),
        },
      }),
    { invalidates },
  );

  const mine = (tasks.data?.items ?? []).filter((t) => t.projectId === projectId);

  return (
    <div className="pl-4 mt-2 border-l border-line space-y-1">
      {mine.map((task) => (
        <div key={task.id} className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={task.status === 'done'}
            onChange={(e) => toggle.mutate({ id: task.id, done: e.target.checked })}
            className="accent-[var(--st-on-track)]"
            aria-label={task.title}
          />
          <span className={task.status === 'done' ? 'text-fg-subtle line-through' : ''}>
            {task.title}
          </span>
          {task.estimate !== null && (
            <span className="mono text-[11px] text-fg-subtle">{task.estimate}</span>
          )}
        </div>
      ))}

      <form
        className="flex gap-2 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate(undefined as never);
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task…" />
        <Input
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
          placeholder="effort"
          type="number"
          className="w-20"
          aria-label="Effort estimate"
        />
        <Button type="submit" disabled={title.trim() === ''}>Add</Button>
      </form>
    </div>
  );
}

function Habits() {
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('weekly');

  const habits = useApi(keys.habits, () => trpc.habits.list.query({ limit: 100 }));
  const create = useApiMutation(
    () => trpc.habits.create.mutate({ name, cadence, targetPerPeriod: 1 }),
    { invalidates: [keys.habits], onSuccess: () => setName('') },
  );

  return (
    <Card title="Habits">
      {habits.data?.items.length === 0 && (
        <Empty
          title="No habits yet"
          hint="Habits contribute through consistency rate, not through count."
        />
      )}

      <ul className="list-none p-0 m-0 space-y-1">
        {(habits.data?.items ?? []).map((habit) => (
          <li key={habit.id} className="flex items-center gap-3 text-[13px]">
            <span className="flex-1">{habit.name}</span>
            <Subtle>{habit.cadence}</Subtle>
            <span className="mono text-[11px] text-fg-subtle">
              streak {habit.currentStreak}
            </span>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 pt-3 border-t border-line flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(undefined as never);
        }}
      >
        <Select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as 'weekly')}
          className="w-28"
          aria-label="Cadence"
        >
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
        </Select>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New habit…" />
        <Button type="submit" disabled={name.trim() === ''}>Add</Button>
      </form>
      {create.isError && <ErrorNote error={create.error} />}
    </Card>
  );
}
