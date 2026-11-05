import { Icon } from '../../components/icon.js';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorNote } from '../../components/ui.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';
import { saveHabit } from '../../lib/daily-cache.js';

export type HabitState = Awaited<ReturnType<typeof trpc.habits.browse.query>>['items'][number];
const PERIOD: Record<string, string> = { daily: 'today', weekly: 'this week', monthly: 'this month', quarterly: 'this quarter', adhoc: 'today' };

export function HabitRow({ habit, date }: { habit: HabitState; date: string }) {
  const client = useQueryClient();
  const check = useApiMutation((input: { completed: boolean; date: string }) => trpc.habits.checkIn.mutate({
    habitId: habit.id, ...input, requireToday: true,
  }), {
    invalidates: [keys.today, keys.habits, keys.goals],
    onSuccess: (_entry, input) => saveHabit(client, habit.id, input.date, input.completed),
    onError: () => {
      void client.invalidateQueries({ queryKey: keys.today });
      void client.invalidateQueries({ queryKey: keys.habits });
    },
  });
  const checked = check.isPending && check.variables.date === date ? check.variables.completed : habit.checkedToday;
  const days = Math.max(0, habit.completedDays + Number(checked) - Number(habit.checkedToday));
  return <div>
    <div className="habit-row">
      <div className="flex-1 min-w-0">
        <h3>{habit.name}</h3>
        <div className="row-meta">{habit.cadence === 'adhoc' ? (checked ? 'Checked in today' : 'Whenever it feels right') : `${days} of ${habit.targetPerPeriod} ${habit.targetPerPeriod === 1 ? 'day' : 'days'} ${PERIOD[habit.cadence]}`}</div>
        {habit.cadence !== 'adhoc' && <div className="progress-track mt-2 max-w-40"><span style={{ width: `${Math.min(100, days / habit.targetPerPeriod * 100)}%`, background: days >= habit.targetPerPeriod ? 'var(--st-on-track)' : 'var(--accent)' }} /></div>}
        {check.isPending && <span className="row-meta" role="status">Saving…</span>}
      </div>
      <button className="check-button" aria-label={`${checked ? 'Undo check-in for' : 'Check in to'} ${habit.name}`} aria-pressed={checked} aria-busy={check.isPending} disabled={check.isPending} onClick={() => check.mutate({ completed: !habit.checkedToday, date })}>
        <span className="check-shape">{checked && <Icon name="check" size={14} />}</span>
      </button>
    </div>
    {check.isError && <ErrorNote error={check.error} />}
  </div>;
}
