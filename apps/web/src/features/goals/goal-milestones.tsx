import { useState } from 'react';
import { Button, Card, ErrorNote, Input, Skeleton } from '../../components/ui.js';
import { Icon } from '../../components/icon.js';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

export function GoalMilestones({ goalId }: { goalId: string }) {
  const [name, setName] = useState('');
  const workspace = useApi(['goals', goalId, 'workspace'], () => trpc.goals.workspace.query({ id: goalId }));
  const invalidates = [keys.goals, keys.milestones, keys.today];
  const create = useApiMutation(() => trpc.milestones.create.mutate({ goalId, name: name.trim() }), {
    invalidates, onSuccess: () => setName(''),
  });
  const toggle = useApiMutation((input: { id: string; achieved: boolean; version: number }) => trpc.milestones.update.mutate({
    id: input.id, expectedVersion: input.version, patch: { achieved: input.achieved, achievedAt: input.achieved ? Date.now() : null },
  }), { invalidates });
  return <Card title="Milestones along the way">
    {workspace.isPending && <Skeleton className="h-20 w-full" />}
    {workspace.isError && <ErrorNote error={workspace.error} />}
    {workspace.data?.milestones.length === 0 && <p className="row-meta !text-[14px]">Mark a meaningful checkpoint. Link it in tracking settings if it should count toward progress.</p>}
    {workspace.data?.milestones.map((item) => <div className="due-row" key={item.id}>
      <button className="check-button" aria-label={`${item.achieved ? 'Reopen' : 'Complete'} milestone ${item.name}`} aria-pressed={item.achieved} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: item.id, achieved: !item.achieved, version: item.version })}><span className="check-shape">{item.achieved && <Icon name="check" size={14} />}</span></button>
      <span className={'text-[14px] break-words ' + (item.achieved ? 'line-through text-fg-subtle' : '')}>{item.name}</span>
    </div>)}
    {toggle.isError && <ErrorNote error={toggle.error} />}
    <form className="flex gap-2 mt-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !create.isPending) create.mutate(undefined); }}>
      <Input aria-label="New milestone" placeholder="A meaningful checkpoint…" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      <Button type="submit" disabled={!name.trim() || create.isPending}>Add</Button>
    </form>
    {create.isError && <ErrorNote error={create.error} />}
  </Card>;
}
