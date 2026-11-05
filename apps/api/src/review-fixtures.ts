import type { TestApi } from './testing.js';
import { dayStamp, planningDate, shiftDate } from '@aryesh/domain';

const DAY = 86_400_000;

/** Entirely fictional fixtures, only loaded by the isolated review server. */
export async function seedReview(api: TestApi, now: number) {
  const caller = api.as('full');
  const date = planningDate(now);
  const work = await caller.areas.create({ name: 'Meaningful work', color: '#b1a1ff' });
  const health = await caller.areas.create({ name: 'Health & energy', color: '#9dbaaa' });
  const personal = await caller.areas.create({ name: 'Personal growth', color: '#d7af7e' });
  const metric = await caller.metrics.create({
    key: 'portfolio_chapters', name: 'Portfolio case studies', areaId: work.id,
    unit: 'count', direction: 'increase', cadence: 'weekly', source: 'manual', baseline: 0, target: 10,
  });
  const goal = await caller.goals.create({
    areaId: work.id, name: 'Build a portfolio I am proud of', importance: 5,
    why: 'Make space for thoughtful work, and share the story behind it.',
    startDate: now - 30 * DAY, targetDate: now + 30 * DAY,
    progressModel: { mode: 'metric', metricId: metric.id },
  });
  const walk = await caller.habits.create({ areaId: health.id, name: 'Go for an evening walk', cadence: 'weekly', targetPerPeriod: 5 });
  const read = await caller.habits.create({ areaId: personal.id, name: 'Read a few pages', cadence: 'weekly', targetPerPeriod: 4 });
  await caller.habits.create({ areaId: health.id, name: 'A quiet start, without my phone', cadence: 'daily' });
  const energy = await caller.goals.create({
    areaId: health.id, name: 'Feel a little stronger each week', importance: 4, measurementMode: 'momentum',
    why: 'Build a routine that gives me energy for the rest of my life.',
  });
  await caller.relations.create({ kind: 'contributes_to', fromType: 'habit', fromId: walk.id, toType: 'goal', toId: energy.id, weight: 1, evaluation: 'rate', expectedRate: { value: 5, per: 'week' } });
  await caller.goals.create({ areaId: personal.id, name: 'Learn something that opens a new door', importance: 3 });
  for (let i = 12; i >= 1; i--) {
    const at = now - i * DAY;
    api.core.setNow(at);
    await caller.readings.record({ metricId: metric.id, at, value: 2 + (12 - i) * .36 });
    if (i % 3 !== 0) await caller.habits.checkIn({ habitId: walk.id, date: planningDate(at), completed: true });
    await api.core.snapshots.run(at);
  }
  api.core.setNow(now);
  const project = await caller.projects.create({ name: 'Portfolio refresh', areaId: work.id });
  await caller.relations.create({ kind: 'contributes_to', fromType: 'project', fromId: project.id, toType: 'goal', toId: goal.id, weight: 1 });
  const a = await caller.tasks.create({ title: 'Write the story behind my latest project', projectId: project.id, dueDate: dayStamp(date) });
  const b = await caller.tasks.create({ title: 'Take a walk and leave the phone at home' });
  const c = await caller.tasks.create({ title: 'Make time for a chapter', status: 'done', completedAt: now });
  await caller.today.saveFocus({ date, taskIds: [a.id, b.id, c.id], revision: 0 });
  await caller.tasks.create({ title: 'Review the first draft and collect the examples I want to share with a future collaborator', dueDate: dayStamp(shiftDate(date, -2)) });
  await caller.tasks.create({ title: 'Plan a calm start to next week', dueDate: dayStamp(date) });
  await caller.habits.checkIn({ habitId: read.id, date, completed: true });
  await caller.milestones.create({ goalId: goal.id, name: 'Choose the work I want to share', achieved: true });
  await caller.milestones.create({ goalId: goal.id, name: 'Publish the first case study' });
  await caller.metrics.create({ key: 'sleep_hours', name: 'Hours of sleep', areaId: health.id, unit: 'duration', direction: 'increase', cadence: 'daily', source: 'manual', baseline: 0, target: 8 });
  await caller.accounts.create({ name: 'Everyday account (sample)', kind: 'bank', currency: 'INR', balanceMinor: 1250000 });
  return { goalId: goal.id };
}
