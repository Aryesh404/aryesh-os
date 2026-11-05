import { Icon } from '../../components/icon.js';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorNote } from '../../components/ui.js';
import { keys, useApiMutation } from '../../lib/query.js';
import { trpc } from '../../lib/trpc.js';

export type HabitState = Awaited<ReturnType<typeof trpc.habits.browse.query>>['items'][number];
const PERIOD: Record<string, string> = { daily: 'today', weekly: 'this week', monthly: 'this month', quarterly: 'this quarter', adhoc: 'today' };

export function HabitRow({ habit, date }: { habit: HabitState; date: string }) {
  const client = useQueryClient();
  const check = useApiMutation(() => trpc.habits.checkIn.mutate({
    habitId: habit.id, date, completed: !habit.checkedToday, requireToday: true,
  }), {
    invalidates: [keys.today, keys.habits, keys.goals],
    onError: () => {
      void client.invalidateQueries({ queryKey: keys.today });
      void client.invalidateQueries({ queryKey: keys.habits });
    },
  });
  return <div>
    <div className="habit-row">
      <div className="flex-1 min-w-0">
        <h3>{habit.name}</h3>
        <div className="row-meta">{habit.cadence === 'adhoc' ? (habit.checkedToday ? 'Checked in today' : 'Whenever it feels right') : `${habit.completedDays} of ${habit.targetPerPeriod} ${habit.targetPerPeriod === 1 ? 'day' : 'days'} ${PERIOD[habit.cadence]}`}</div>
        {habit.cadence !== 'adhoc' && <div className="progress-track mt-2 max-w-40"><span style={{ width: `${Math.min(100, habit.completedDays / habit.targetPerPeriod * 100)}%`, background: habit.completedDays >= habit.targetPerPeriod ? 'var(--st-on-track)' : 'var(--accent)' }} /></div>}
      </div>
      <button className="check-button" aria-label={`${habit.checkedToday ? 'Undo check-in for' : 'Check in to'} ${habit.name}`} aria-pressed={habit.checkedToday} disabled={check.isPending} onClick={() => check.mutate(undefined)}>
        <span className="check-shape">{habit.checkedToday && <Icon name="check" size={14} />}</span>
      </button>
    </div>
    {check.isError && <ErrorNote error={check.error} />}
  </div>;
}
