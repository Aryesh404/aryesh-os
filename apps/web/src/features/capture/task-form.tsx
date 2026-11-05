import { useState } from 'react';
import { Button, ErrorNote, Field, Input } from '../../components/ui.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { fromDateInput } from '../../lib/format.js';
import { trpc } from '../../lib/trpc.js';

export function TaskForm({ onSaved, onCancel }: {
  onSaved: (task: Awaited<ReturnType<typeof trpc.tasks.create.mutate>>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const save = useApiMutation(() => trpc.tasks.create.mutate({
    title: title.trim(), ...(due ? { dueDate: fromDateInput(due) } : {}),
  }), { invalidates: [keys.tasks, keys.today], onSuccess: onSaved });
  return <form onSubmit={(event) => { event.preventDefault(); if (title.trim() && !save.isPending) save.mutate(undefined); }}>
    <Field label="What would you like to do?"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A small, clear next step" maxLength={300} required /></Field>
    <div className="mt-5"><Field label="Due date" hint="Optional. You can choose this task as a priority without a due date."><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field></div>
    {save.isError && <div className="mt-4"><ErrorNote error={save.error} /></div>}
    <div className="dialog-actions"><Button type="button" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" disabled={!title.trim() || save.isPending}>{save.isPending ? 'Saving…' : 'Add task'}</Button></div>
  </form>;
}
