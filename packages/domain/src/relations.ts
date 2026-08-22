import type { RelationKind } from './enums.js';

/**
 * Object kinds that can appear at the end of a relation. Extended in later
 * phases (business, client, account, transaction, decision, insight).
 */
export const OBJECT_KINDS = [
  'area',
  'theme',
  'goal',
  'milestone',
  'metric',
  'project',
  'task',
  'habit',
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export interface Endpoint {
  from: ObjectKind;
  to: ObjectKind;
}

/**
 * docs/02 §2 — which endpoints each relation kind accepts.
 *
 * `belongs_to` is deliberately absent: every containment in the fixed domain is
 * already a foreign key (`goal.themeId`, `task.projectId`, `milestone.goalId`).
 * Storing it a second time as an edge would create two sources of truth that
 * can drift. The graph derives containment edges from the FKs instead.
 */
export const RELATION_ENDPOINTS: Record<RelationKind, Endpoint[] | 'any'> = {
  contributes_to: [
    { from: 'goal', to: 'goal' },
    { from: 'project', to: 'goal' },
    { from: 'metric', to: 'goal' },
    { from: 'milestone', to: 'goal' },
    { from: 'habit', to: 'goal' },
  ],
  depends_on: [
    { from: 'task', to: 'task' },
    { from: 'project', to: 'project' },
    { from: 'goal', to: 'goal' },
    { from: 'milestone', to: 'milestone' },
  ],
  measures: [
    { from: 'metric', to: 'goal' },
    { from: 'metric', to: 'project' },
    { from: 'metric', to: 'habit' },
  ],
  informed_by: [],
  relates_to: 'any',
  belongs_to: [],
};

/** Relation kinds that may never contain a cycle. */
export const ACYCLIC_KINDS: RelationKind[] = ['contributes_to', 'depends_on'];

/** Only these edges feed the progress engine (docs/03 §5 rule 1). */
export const SCORING_KIND: RelationKind = 'contributes_to';

export type EndpointCheck =
  | { valid: true }
  | { valid: false; reason: string };

export function checkEndpoints(
  kind: RelationKind,
  from: ObjectKind,
  to: ObjectKind,
): EndpointCheck {
  const allowed = RELATION_ENDPOINTS[kind];

  if (allowed === 'any') return { valid: true };

  if (kind === 'belongs_to') {
    return {
      valid: false,
      reason:
        'belongs_to is derived from foreign keys, not stored as an edge. Set the ' +
        'parent field on the record instead (docs/02 §2).',
    };
  }

  if (allowed.length === 0) {
    return { valid: false, reason: `${kind} has no valid endpoints yet` };
  }

  if (allowed.some((e) => e.from === from && e.to === to)) return { valid: true };

  // The one refusal worth explaining rather than just rejecting: activity is
  // not advancement (docs/03 §4.4).
  if (kind === 'contributes_to' && from === 'task') {
    return {
      valid: false,
      reason:
        'A task cannot contribute to a goal directly. Task completion is activity, ' +
        'not advancement — let the task roll up through its project, and give the ' +
        'project an explicit weighted contribution (docs/03 §4.4).',
    };
  }

  const options = allowed.map((e) => `${e.from}→${e.to}`).join(', ');
  return {
    valid: false,
    reason: `${kind} does not accept ${from}→${to}. Valid: ${options}.`,
  };
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

export interface Edge {
  fromId: string;
  toId: string;
}

/**
 * Breadth-first search for a path from `startId` to `targetId`. Pure, and
 * returns the path so the caller can show it rather than saying "cycle
 * detected" and leaving the user to find it (docs/02 §8 invariant 5).
 */
export function findPath(
  edges: readonly Edge[],
  startId: string,
  targetId: string,
): string[] | null {
  if (startId === targetId) return [startId];

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.fromId);
    if (list) list.push(edge.toId);
    else adjacency.set(edge.fromId, [edge.toId]);
  }

  const previous = new Map<string, string>();
  const seen = new Set<string>([startId]);
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);

      if (next === targetId) {
        const path = [next];
        let step = current;
        while (step !== startId) {
          path.push(step);
          step = previous.get(step) as string;
        }
        path.push(startId);
        return path.reverse();
      }
      queue.push(next);
    }
  }

  return null;
}

/**
 * Adding `from → to` creates a cycle when `to` can already reach `from`.
 * Returns the offending path, ending back at `to`.
 */
export function findCycle(
  edges: readonly Edge[],
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId, toId];
  const path = findPath(edges, toId, fromId);
  return path === null ? null : [...path, toId];
}
