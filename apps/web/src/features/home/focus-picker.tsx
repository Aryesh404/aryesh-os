import { useState } from 'react';
import type { DailyFocus } from '@aryesh/domain';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, ErrorNote, Input, Skeleton } from '../../components/ui.js';
import { Icon } from '../../components/icon.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { useRecords } from '../../lib/use-records.js';
import { trpc } from '../../lib/trpc.js';
import { TaskForm } from '../capture/task-form.js';
import type { TaskRow } from './task-check.js';

export function FocusPicker({ focus, selectedTasks, unfinished, onClose }: {
  focus: DailyFocus; selectedTasks: TaskRow[]; unfinished: TaskRow[]; onClose: () => void;
}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState(selectedTasks.map((t) => t.id));
  const [revision, setRevision] = useState(focus.revision);
  const [known, setKnown] = useState<TaskRow[]>([...selectedTasks, ...unfinished]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const tasks = useRecords(['tasks', 'focus', q], (page) => trpc.tasks.browse.query({ ...page, q, openOnly: true }));
  const save = useApiMutation(() => trpc.today.saveFocus.mutate({ date: focus.date, taskIds: selected, revision }), {
    invalidates: [keys.today], onSuccess: onClose,
  });
  const [refreshError, setRefreshError] = useState<Error | null>(null);
  const reload = async () => {
    try {
      const latest = await trpc.today.summary.query();
      await client.invalidateQueries({ queryKey: keys.today });
      if (latest.date !== focus.date) { onClose(); return; }
      setSelected(latest.focusTasks.map((t) => t.id)); setRevision(latest.focus.revision);
      setKnown(latest.focusTasks); save.reset(); setRefreshError(null);
    } catch (error) { setRefreshError(error instanceof Error ? error : new Error('Could not refresh priorities.')); }
  };
  const all = [...new Map([...known, ...tasks.items].map((t) => [t.id, t])).values()];
  const pick = (id: string) => setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : ids.length < 3 ? [...ids, id] : ids);
  const row = (task: TaskRow) => <button key={task.id} className="choice-row" aria-pressed={selected.includes(task.id)}
    disabled={save.isPending || (!selected.includes(task.id) && selected.length === 3)} onClick={() => { setKnown(all); pick(task.id); }}>
    <span className="check-shape shrink-0">{selected.includes(task.id) && <Icon name="check" size={14} />}</span>
    <span className="flex-1 break-words">{task.title}</span>
    {task.status === 'done' && <span className="pill">Done</span>}
  </button>;
  return <Dialog title={creating ? 'Add a task' : 'Give today a little direction'} onClose={onClose}>
    {creating ? <TaskForm onCancel={() => setCreating(false)} onSaved={(task) => {
      setKnown((items) => [...items, task]); setSelected((ids) => ids.length < 3 ? [...ids, task.id] : ids); setCreating(false);
    }} /> : <>
      <p className="page-description mb-5">Choose up to three things that deserve your attention.</p>
      <div className="flex items-center justify-between mb-2"><span className="eyebrow !m-0">Your choices · {selected.length}/3</span><button className="text-action" disabled={save.isPending} onClick={() => setCreating(true)}><Icon name="plus" size={15} />New task</button></div>
      {selected.length === 0 && <p className="row-meta mb-4">Start small. One priority is enough.</p>}
      {selected.flatMap((id) => all.filter((t) => t.id === id)).map(row)}
      {focus.taskIds.length !== selectedTasks.length && <p className="notice mt-3">A task was removed. Save to clear it from today's priorities.</p>}
      {!!unfinished.length && !q && <div className="mt-5"><p className="eyebrow">Unfinished from yesterday</p>{unfinished.filter((t) => !selected.includes(t.id)).map(row)}</div>}
      <Input className="mt-5" aria-label="Find a task" placeholder="Find an existing task…" value={q} onChange={(e) => setQ(e.target.value)} />
      {tasks.isPending && <Skeleton className="h-24 w-full mt-4" />}
      {tasks.isError && <ErrorNote error={tasks.error} />}
      <div className="max-h-64 overflow-y-auto mt-2">{tasks.items.filter((t) => !selected.includes(t.id)).map(row)}</div>
      {tasks.isSuccess && !tasks.items.length && <p className="quiet-empty">No matching tasks. Add one above to get started.</p>}
      {tasks.hasNextPage && <Button className="mt-3" disabled={tasks.isFetchingNextPage} onClick={() => void tasks.fetchNextPage()}>Load more tasks</Button>}
      {save.isError && <div className="mt-4"><ErrorNote error={save.error} /><button className="text-action" onClick={() => void reload()}>Use latest priorities</button></div>}
      {refreshError && <ErrorNote error={refreshError} />}
      <div className="dialog-actions"><Button onClick={onClose} disabled={save.isPending}>Cancel</Button><Button variant="primary" onClick={() => save.mutate(undefined)} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save priorities'}</Button></div>
    </>}
  </Dialog>;
}
