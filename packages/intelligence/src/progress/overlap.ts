import type { ContributorInput } from '../types.js';

/**
 * docs/03 §5 rule 5, from docs/14 Case 4.
 *
 * Two contributors derived from the same underlying events — a
 * `modules_completed` metric alongside the milestone set it counts — would count
 * the same advancement twice and report roughly double the truth while looking
 * entirely legitimate. Detected when the model is saved, because it is cheap now
 * and expensive to discover months later inside a number you trusted.
 */

export interface Overlap {
  kind: 'duplicate' | 'shared_source';
  contributors: Array<{ refId: string; label: string }>;
  /** What the two are both counting. */
  source: string;
  message: string;
}

export function findOverlaps(contributors: readonly ContributorInput[]): Overlap[] {
  const overlaps: Overlap[] = [];

  // Same thing added twice.
  const byRef = new Map<string, ContributorInput[]>();
  for (const c of contributors) {
    const key = `${c.kind}:${c.refId}`;
    const list = byRef.get(key);
    if (list) list.push(c);
    else byRef.set(key, [c]);
  }
  for (const [key, group] of byRef) {
    if (group.length > 1) {
      overlaps.push({
        kind: 'duplicate',
        contributors: group.map((c) => ({ refId: c.refId, label: c.label })),
        source: key,
        message: `'${group[0]?.label}' is included ${group.length} times, so its advancement is counted ${group.length} times.`,
      });
    }
  }

  // Different contributors reading the same underlying events.
  const bySource = new Map<string, ContributorInput[]>();
  for (const c of contributors) {
    for (const source of c.sources ?? []) {
      const list = bySource.get(source);
      if (list) list.push(c);
      else bySource.set(source, [c]);
    }
  }
  for (const [source, group] of bySource) {
    const distinct = new Map(group.map((c) => [`${c.kind}:${c.refId}`, c]));
    if (distinct.size > 1) {
      const members = [...distinct.values()];
      overlaps.push({
        kind: 'shared_source',
        contributors: members.map((c) => ({ refId: c.refId, label: c.label })),
        source,
        message: `${members
          .map((c) => `'${c.label}'`)
          .join(' and ')} both count ${source}, so that advancement lands twice. Keep one.`,
      });
    }
  }

  return overlaps;
}
