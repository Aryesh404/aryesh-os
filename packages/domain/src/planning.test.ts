import { describe, expect, it } from 'vitest';
import { dayStamp, habitPeriod, isCalendarDate, planningDate, shiftDate } from './planning.js';

describe('the planning calendar', () => {
  it('uses India midnight independently of the device timezone', () => {
    expect(planningDate(Date.parse('2026-10-31T18:29:59Z'))).toBe('2026-10-31');
    expect(planningDate(Date.parse('2026-10-31T18:30:00Z'))).toBe('2026-11-01');
  });
  it('rejects impossible dates and handles leap days', () => {
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('uses Monday weeks and calendar months and quarters', () => {
    expect(habitPeriod('2026-11-01', 'weekly')).toEqual({ start: dayStamp('2026-10-26'), end: dayStamp('2026-11-02') });
    expect(habitPeriod('2026-11-01', 'monthly')).toEqual({ start: dayStamp('2026-11-01'), end: dayStamp('2026-12-01') });
    expect(habitPeriod('2026-11-01', 'quarterly')).toEqual({ start: dayStamp('2026-10-01'), end: dayStamp('2027-01-01') });
  });
});
