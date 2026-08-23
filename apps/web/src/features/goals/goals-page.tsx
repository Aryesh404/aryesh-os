import { useState } from 'react';
import { Button, Dialog, Empty, ErrorNote, Field, Input, Select, Skeleton, Subtle, Textarea } from '../../components/ui.tsx';
import { ProgressRing } from '../../components/metric.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date, dateInput, fromDateInput } from '../../lib/format.js';
import type { Route } from '../../app.js';

export function GoalsPage({ navigate }: { navigate: (route: Route) => void }) {
  const [creating, setCreating] = useState(false);
  const goals = useApi(keys.goals, () => trpc.goals.list.query({ limit: 100 }));
  const areas = useApi(keys.areas, () => trpc.areas.list.query({ limit: 100 }));

  const areaOf = (id: string): { name: string; color: string } | undefined =>
    (areas.data?.items ?? []).find((a) => a.id === id);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold m-0">Goals</h1>
          <Subtle>What you are trying to achieve, and how it is measured</Subtle>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          New goal
        </Button>
      </header>

      {goals.isPending && <Skeleton className="h-24 w-full" />}
      {goals.isError && <ErrorNote error={goals.error} />}

      {goals.data?.items.length === 0 && (
        <Empty
          title="No goals yet"
          hint="A goal needs an area. Create one under Structure first if you have none."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create your first goal
            </Button>
          }
        />
      )}

      <div className="grid gap-3">
        {(goals.data?.items ?? []).map((goal) => {
          const area = areaOf(goal.areaId);
          return (
            <button
              key={goal.id}
              onClick={() => navigate({ name: 'goal', id: goal.id })}
              className="text-left bg-surface border border-line rounded-card p-4 flex items-center gap-4 hover:border-line-strong transition-colors duration-[120ms]"
            >
              <ProgressRing
                value={goal.measurementMode === 'momentum' ? null : goal.progress}
                confidence={goal.confidence ?? 0}
                {...(area ? { areaColor: area.color } : {})}
                size={56}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium truncate">{goal.name}</span>
                  {goal.measurementMode === 'momentum' && (
                    <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                      momentum
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-fg-subtle mt-0.5 flex gap-3">
                  {area && <span style={{ color: area.color }}>{area.name}</span>}
                  <span>
                    {goal.targetDate ? `by ${date(goal.targetDate)}` : 'no target date'}
                  </span>
                </div>
                {goal.degradedReason && (
                  <div className="text-[11px] text-at-risk mt-1 truncate">
                    ◆ {goal.degradedReason}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {creating && (
        <NewGoalDialog
          areas={(areas.data?.items ?? []).map((a) => ({ id: a.id, name: a.name }))}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate({ name: 'goal', id });
          }}
        />
      )}
    </div>
  );
}

function NewGoalDialog({
  areas,
  onClose,
  onCreated,
}: {
  areas: Array<{ id: string; name: string }>;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [areaId, setAreaId] = useState(areas[0]?.id ?? '');
  const [why, setWhy] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [mode, setMode] = useState<'completion' | 'momentum'>('completion');

  const create = useApiMutation(
    (input: Parameters<typeof trpc.goals.create.mutate>[0]) =>
      trpc.goals.create.mutate(input),
    { invalidates: [keys.goals], onSuccess: (goal) => onCreated(goal.id) },
  );

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    create.mutate({
      areaId,
      name,
      measurementMode: mode,
      ...(why ? { why } : {}),
      ...(targetDate ? { targetDate: fromDateInput(targetDate) } : {}),
    });
  };

  if (areas.length === 0) {
    return (
      <Dialog title="New goal" onClose={onClose}>
        <Empty
          title="You need an area first"
          hint="Areas are your top-level structure — Business, Career, Finance, and so on."
        />
      </Dialog>
    );
  }

  return (
    <Dialog title="New goal" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="₹5L MRR by March 2027"
          />
        </Field>

        <Field label="Area">
          <Select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Why this exists"
          hint="What makes it worth protecting when it stalls"
        >
          <Textarea value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Target date"
            hint="Optional — undated goals are judged on momentum"
          >
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              max={dateInput(Date.now() + 40 * 365 * 86_400_000)}
            />
          </Field>

          <Field
            label="Measurement"
            hint={
              mode === 'completion'
                ? 'A percentage toward a definable end'
                : 'Rate vs expected — no percentage'
            }
          >
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'completion' | 'momentum')}
            >
              <option value="completion">Completion</option>
              <option value="momentum">Momentum</option>
            </Select>
          </Field>
        </div>

        {create.isError && <ErrorNote error={create.error} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || name.trim() === ''}
          >
            {create.isPending ? 'Creating…' : 'Create goal'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
