import { useState } from 'react';
import { Button, Card, Empty, ErrorNote, Input, Skeleton, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { date } from '../../lib/format.js';
import { ExplainPanel, type Outcome } from './explain-panel.tsx';
import { ProgressModelEditor } from './progress-model-editor.tsx';
import { TrajectoryPanel } from './trajectory-panel.tsx';
import type { Route } from '../../app.js';

export function GoalDetail({
  id,
  navigate,
}: {
  id: string;
  navigate: (route: Route) => void;
}) {
  const goal = useApi(keys.goal(id), () => trpc.goals.byId.query({ id }));
  const explain = useApi(keys.explain(id), () => trpc.goals.explain.query({ id }));
  const overlaps = useApi(['goals', id, 'overlaps'], () =>
    trpc.goals.checkOverlaps.query({ id }),
  );

  if (goal.isPending) return <Skeleton className="h-40 w-full" />;
  if (goal.isError) return <ErrorNote error={goal.error} />;
  if (!goal.data) return <Empty title="Goal not found" />;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            onClick={() => navigate({ name: 'goals' })}
            className="text-[12px] text-fg-subtle hover:text-fg-muted mb-1"
          >
            ← Goals
          </button>
          <h1 className="text-[20px] font-semibold m-0 truncate">{goal.data.name}</h1>
          <div className="text-[12px] text-fg-subtle mt-1 flex gap-3">
            <span>
              {goal.data.targetDate
                ? `target ${date(goal.data.targetDate)}`
                : 'no target date — judged on momentum'}
            </span>
            <span>{goal.data.measurementMode}</span>
          </div>
        </div>
      </header>

      {goal.data.why && (
        <Card title="Why this exists">
          <p className="m-0 text-fg-muted">{goal.data.why}</p>
        </Card>
      )}

      {/* docs/03 §5 rule 5 — surfaced before it can quietly double a number. */}
      {(overlaps.data ?? []).length > 0 && (
        <div className="border border-at-risk/40 bg-at-risk/5 rounded-card p-4">
          <h2 className="text-[11px] uppercase tracking-[0.08em] text-at-risk m-0 mb-2">
            Double counting
          </h2>
          <ul className="list-none p-0 m-0 space-y-1">
            {(overlaps.data ?? []).map((overlap) => (
              <li key={overlap.source} className="text-[13px] text-fg-muted">
                {overlap.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TrajectoryPanel goalId={id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <ProgressModelEditor goalId={id} />

        <Card title="How this number is produced">
          {explain.isPending && <Skeleton className="h-32 w-full" />}
          {explain.isError && <ErrorNote error={explain.error} />}
          {explain.data && <ExplainPanel outcome={explain.data as Outcome} />}
        </Card>
      </div>

      <Milestones goalId={id} />
    </div>
  );
}

function Milestones({ goalId }: { goalId: string }) {
  const [name, setName] = useState('');
  const milestones = useApi(keys.milestones, () => trpc.milestones.list.query({ limit: 200 }));

  const invalidates = [keys.milestones, keys.explain(goalId), ['goals', goalId, 'contributors']];

  const create = useApiMutation(
    (input: { name: string }) =>
      trpc.milestones.create.mutate({ goalId, name: input.name }),
    { invalidates, onSuccess: () => setName('') },
  );

  const toggle = useApiMutation(
    (input: { id: string; achieved: boolean }) =>
      trpc.milestones.update.mutate({
        id: input.id,
        patch: {
          achieved: input.achieved,
          achievedAt: input.achieved ? Date.now() : null,
        },
      }),
    { invalidates },
  );

  const mine = (milestones.data?.items ?? []).filter((m) => m.goalId === goalId);

  return (
    <Card title="Milestones">
      {mine.length === 0 ? (
        <Subtle>
          Discrete checkpoints. Add them as contributors to have them count toward
          progress.
        </Subtle>
      ) : (
        <ul className="list-none p-0 m-0 space-y-1">
          {mine.map((milestone) => (
            <li key={milestone.id} className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                checked={milestone.achieved}
                onChange={(e) =>
                  toggle.mutate({ id: milestone.id, achieved: e.target.checked })
                }
                className="accent-[var(--st-on-track)]"
                aria-label={milestone.name}
              />
              <span className={milestone.achieved ? 'text-fg-subtle line-through' : ''}>
                {milestone.name}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex gap-2 mt-3 pt-3 border-t border-line"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim() });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a milestone…"
        />
        <Button type="submit" disabled={name.trim() === ''}>
          Add
        </Button>
      </form>
    </Card>
  );
}
