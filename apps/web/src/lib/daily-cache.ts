import type { QueryClient } from '@tanstack/react-query';
import { dayStamp, shiftDate } from '@aryesh/domain';
import type { trpc } from './trpc.js';
import { keys } from './query.js';

type Today = Awaited<ReturnType<typeof trpc.today.summary.query>>;
type Task = Today['focusTasks'][number];
type Habit = Today['habits'][number];

export async function saveTask(client: QueryClient, task: Task) {
  if (!task.id) return;
  await client.cancelQueries({ queryKey: keys.today });
  client.setQueryData<Today>(keys.today, (old) => {
    if (!old) return old;
    const open = task.status !== 'done' && task.status !== 'cancelled';
    const previous = [...old.focusTasks, ...old.dueTasks].find((row) => row.id === task.id);
    const wasDue = previous && previous.status !== 'done' && previous.status !== 'cancelled' &&
      previous.dueDate !== null && previous.dueDate < dayStamp(shiftDate(old.date, 1));
    return { ...old,
      focusTasks: old.focusTasks.map((row) => row.id === task.id ? task : row),
      dueTasks: old.dueTasks.flatMap((row) => row.id === task.id ? (open ? [task] : []) : [row]),
      dueCount: wasDue && !open ? Math.max(0, old.dueCount - 1) : old.dueCount,
    };
  });
}

export async function saveHabit(client: QueryClient, habitId: string, date: string, completed: boolean) {
  await Promise.all([client.cancelQueries({ queryKey: keys.today }), client.cancelQueries({ queryKey: keys.habits })]);
  const update = (habit: Habit) => habit.id !== habitId ? habit : {
    ...habit, checkedToday: completed,
    completedDays: Math.max(0, habit.completedDays + Number(completed) - Number(habit.checkedToday)),
  };
  client.setQueryData<Today>(keys.today, (old) => old?.date === date ? { ...old, habits: old.habits.map(update) } : old);
  type Browse = Awaited<ReturnType<typeof trpc.habits.browse.query>>;
  client.setQueriesData<{ pages: Browse[] }>({ queryKey: keys.habits }, (old) => old?.pages ? {
    ...old, pages: old.pages.map((page) => page.date === date ? { ...page, items: page.items.map(update) } : page),
  } : old);
}
