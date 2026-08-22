import { describe, expect, it } from 'vitest';
import { findOverlaps } from './overlap.js';
import type { ContributorInput } from '../types.js';

const manual = (
  refId: string,
  label: string,
  sources?: string[],
): ContributorInput => ({
  kind: 'manual',
  refId,
  label,
  weight: 1,
  evaluation: 'level',
  value: 0.5,
  ...(sources ? { sources } : {}),
});

describe('findOverlaps', () => {
  it('says nothing when contributors are independent', () => {
    expect(
      findOverlaps([
        manual('a', 'Revenue', ['metric:revenue']),
        manual('b', 'Milestones', ['milestones:goal_1']),
      ]),
    ).toEqual([]);
  });

  it('catches the same contributor added twice', () => {
    const overlaps = findOverlaps([manual('a', 'Revenue'), manual('a', 'Revenue')]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.kind).toBe('duplicate');
    expect(overlaps[0]?.message).toMatch(/counted 2 times/);
  });

  /**
   * docs/14 Case 4 — `core_modules_completed` and the six milestones it counts
   * are the same events. Weighted together, progress runs at roughly double the
   * truth while looking entirely legitimate.
   */
  it('catches two contributors reading the same underlying events', () => {
    const overlaps = findOverlaps([
      manual('metric_modules', 'core_modules_completed', ['milestones:ship_v1']),
      manual('milestones_v1', 'Ship v1 milestones', ['milestones:ship_v1']),
    ]);

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.kind).toBe('shared_source');
    expect(overlaps[0]?.source).toBe('milestones:ship_v1');
    expect(overlaps[0]?.message).toMatch(/both count milestones:ship_v1/);
    expect(overlaps[0]?.message).toMatch(/Keep one/);
  });

  it('does not flag one contributor listing a source once', () => {
    expect(findOverlaps([manual('a', 'A', ['tasks:p1', 'tasks:p1'])])).toEqual([]);
  });

  it('reports each shared source separately', () => {
    const overlaps = findOverlaps([
      manual('a', 'A', ['tasks:p1', 'milestones:g1']),
      manual('b', 'B', ['tasks:p1']),
      manual('c', 'C', ['milestones:g1']),
    ]);
    expect(overlaps.map((o) => o.source).sort()).toEqual(['milestones:g1', 'tasks:p1']);
  });
});
