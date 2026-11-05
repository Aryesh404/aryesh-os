import type { Cadence } from './enums.js';

/** Planning uses one calendar on every device; storage remains UTC milliseconds. */
export const PLANNING_TIME_ZONE = 'Asia/Kolkata';
const DAY = 86_400_000;

export function planningDate(now: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANNING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A date-only key, not the instant of local midnight. Matches habit_entries.date. */
export function dayStamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = dayStamp(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

export function shiftDate(date: string, days: number): string {
  return new Date(dayStamp(date) + days * DAY).toISOString().slice(0, 10);
}

export function habitPeriod(date: string, cadence: Cadence): { start: number; end: number } {
  const day = dayStamp(date);
  const d = new Date(day);
  if (cadence === 'weekly') {
    const start = day - ((d.getUTCDay() + 6) % 7) * DAY;
    return { start, end: start + 7 * DAY };
  }
  if (cadence === 'monthly' || cadence === 'quarterly') {
    const month = cadence === 'quarterly' ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth();
    return {
      start: Date.UTC(d.getUTCFullYear(), month, 1),
      end: Date.UTC(d.getUTCFullYear(), month + (cadence === 'quarterly' ? 3 : 1), 1),
    };
  }
  return { start: day, end: day + DAY };
}

export interface DailyFocus {
  date: string;
  taskIds: string[];
  revision: number;
}
