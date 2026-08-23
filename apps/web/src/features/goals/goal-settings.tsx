import { useState } from 'react';
import { Card, ErrorNote, Field, Input, Select, Subtle } from '../../components/ui.tsx';
import { keys, useApi, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { currencyAmount } from '../../lib/format.js';

type Goal = Awaited<ReturnType<typeof trpc.goals.byId.query>>;

/**
 * docs/15 §5 M9 — theme attachment and the projection model were both
 * supported by the API and unreachable from the interface, which is why themes
 * were decorative and why a compounding goal could only ever project linearly.
 */
export function GoalSettings({ goal }: { goal: Goal }) {
  const themes = useApi(keys.themes, () => trpc.themes.list.query({ limit: 100 }));

  const update = useApiMutation(
    (input: Parameters<typeof trpc.goals.update.mutate>[0]) =>
      trpc.goals.update.mutate(input),
    {
      invalidates: [
        keys.goal(goal.id),
        keys.goals,
        ['goals', goal.id, 'trajectory'],
        keys.themes,
      ],
    },
  );

  const kind = goal.projectionModel?.kind ?? 'linear';

  return (
    <Card title="Settings">
      <div className="space-y-4">
        <Field
          label="Theme"
          hint="Themes group goals under an area. A goal with no theme still works; it just does not roll up."
        >
          <Select
            value={goal.themeId ?? ''}
            onChange={(e) =>
              update.mutate({
                id: goal.id,
                expectedVersion: goal.version,
                patch: { themeId: e.target.value === '' ? null : e.target.value },
              })
            }
          >
            <option value="">No theme</option>
            {(themes.data?.items ?? [])
              .filter((theme) => theme.areaId === goal.areaId)
              .map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
          </Select>
        </Field>

        <Field
          label="Measurement"
          hint="Momentum goals are judged on rate against an expected cadence and never carry a percentage."
        >
          <Select
            value={goal.measurementMode}
            onChange={(e) =>
              update.mutate({
                id: goal.id,
                expectedVersion: goal.version,
                patch: { measurementMode: e.target.value as 'completion' | 'momentum' },
              })
            }
          >
            <option value="completion">Completion — a percentage toward a definable end</option>
            <option value="momentum">Momentum — rate vs expected, no percentage</option>
          </Select>
        </Field>

        <div>
          <Field
            label="Projection"
            hint="How the trajectory is extrapolated. Linear is right for anything that does not grow on its own base."
          >
            <Select
              value={kind}
              onChange={(e) => {
                const next = e.target.value;
                update.mutate({
                  id: goal.id,
                  expectedVersion: goal.version,
                  patch: {
                    projectionModel:
                      next === 'compounding'
                        ? {
                            kind: 'compounding' as const,
                            annualRate: 0.1,
                            contribution: { amount: 0, per: 'month' as const },
                          }
                        : next === 'none'
                          ? { kind: 'none' as const }
                          : { kind: 'linear' as const },
                  },
                });
              }}
            >
              <option value="linear">Linear</option>
              <option value="compounding">Compounding — grows on its own base</option>
              <option value="none">None — do not project</option>
            </Select>
          </Field>

          {goal.projectionModel?.kind === 'compounding' && (
            <CompoundingSettings goal={goal} model={goal.projectionModel} />
          )}
        </div>

        {update.isError && <ErrorNote error={update.error} />}
      </div>
    </Card>
  );
}

function CompoundingSettings({
  goal,
  model,
}: {
  goal: Goal;
  model: Extract<NonNullable<Goal['projectionModel']>, { kind: 'compounding' }>;
}) {
  const [rate, setRate] = useState(String(model.annualRate * 100));
  const [contribution, setContribution] = useState(String(model.contribution.amount));

  const update = useApiMutation(
    (input: Parameters<typeof trpc.goals.update.mutate>[0]) =>
      trpc.goals.update.mutate(input),
    { invalidates: [keys.goal(goal.id), ['goals', goal.id, 'trajectory']] },
  );

  const save = () => {
    const annualRate = Number(rate) / 100;
    update.mutate({
      id: goal.id,
      expectedVersion: goal.version,
      patch: {
        projectionModel: {
          kind: 'compounding' as const,
          annualRate,
          contribution: { amount: Number(contribution), per: 'month' as const },
          // The fan is drawn from the stated rate ± 20%, so the projection
          // shows a range of assumptions rather than one confident curve.
          scenarios: [annualRate * 0.8, annualRate, annualRate * 1.2],
        },
      },
    });
  };

  return (
    <div className="mt-3 pl-3 border-l-2 border-line space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Assumed annual return" hint="%">
          <Input
            type="number"
            step="0.5"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            onBlur={save}
          />
        </Field>
        <Field label="Monthly contribution">
          <Input
            type="number"
            step="1000"
            value={contribution}
            onChange={(e) => setContribution(e.target.value)}
            onBlur={save}
          />
        </Field>
      </div>

      <p className="text-[11px] text-fg-subtle m-0">
        Projecting {currencyAmount(Number(contribution || '0'))}/month at{' '}
        <span className="mono">{rate}%</span>, with a fan at{' '}
        <span className="mono">{(Number(rate) * 0.8).toFixed(1)}%</span>–
        <span className="mono">{(Number(rate) * 1.2).toFixed(1)}%</span>. The return
        rate is an assumption, not an observation — the trajectory says so out loud.
      </p>

      <Subtle>
        Current value and target come from the goal&rsquo;s metric at compute time, so
        the projection cannot drift from the readings.
      </Subtle>

      {update.isError && <ErrorNote error={update.error} />}
    </div>
  );
}
