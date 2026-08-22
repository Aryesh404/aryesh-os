import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkEndpoints, findCycle, findPath, type Edge } from './relations.js';

const edges = (...pairs: Array<[string, string]>): Edge[] =>
  pairs.map(([fromId, toId]) => ({ fromId, toId }));

describe('checkEndpoints', () => {
  it('accepts the shapes the progress engine understands', () => {
    expect(checkEndpoints('contributes_to', 'metric', 'goal').valid).toBe(true);
    expect(checkEndpoints('contributes_to', 'goal', 'goal').valid).toBe(true);
    expect(checkEndpoints('measures', 'metric', 'project').valid).toBe(true);
    expect(checkEndpoints('relates_to', 'habit', 'area').valid).toBe(true);
  });

  it('refuses task → goal with the reason, not just a rejection', () => {
    const result = checkEndpoints('contributes_to', 'task', 'goal');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/activity, not advancement/);
  });

  it('refuses belongs_to because containment is a foreign key', () => {
    const result = checkEndpoints('belongs_to', 'goal', 'area');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/foreign keys/);
  });
});

describe('findPath', () => {
  it('finds a direct edge, a chain, and reports absence', () => {
    const g = edges(['a', 'b'], ['b', 'c'], ['c', 'd']);
    expect(findPath(g, 'a', 'b')).toEqual(['a', 'b']);
    expect(findPath(g, 'a', 'd')).toEqual(['a', 'b', 'c', 'd']);
    expect(findPath(g, 'd', 'a')).toBeNull();
  });

  it('returns the shortest path when several exist', () => {
    const g = edges(['a', 'b'], ['b', 'z'], ['a', 'm'], ['m', 'n'], ['n', 'z']);
    expect(findPath(g, 'a', 'z')).toEqual(['a', 'b', 'z']);
  });

  it('terminates on a graph that already contains a cycle', () => {
    const g = edges(['a', 'b'], ['b', 'c'], ['c', 'a']);
    expect(findPath(g, 'a', 'c')).toEqual(['a', 'b', 'c']);
    expect(findPath(g, 'a', 'zz')).toBeNull();
  });

  it('never returns a path that is not walkable', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('a', 'b', 'c', 'd', 'e'),
            fc.constantFrom('a', 'b', 'c', 'd', 'e'),
          ),
          { maxLength: 20 },
        ),
        fc.constantFrom('a', 'b', 'c', 'd', 'e'),
        fc.constantFrom('a', 'b', 'c', 'd', 'e'),
        (pairs, start, target) => {
          const g = edges(...pairs);
          const path = findPath(g, start, target);
          if (path === null) return true;
          if (path[0] !== start) return false;
          if (path[path.length - 1] !== target) return false;
          for (let i = 0; i < path.length - 1; i++) {
            const hop = g.some((e) => e.fromId === path[i] && e.toId === path[i + 1]);
            if (!hop && !(path.length === 1 && start === target)) return false;
          }
          return true;
        },
      ),
    );
  });
});

describe('findCycle', () => {
  it('detects the loop an edge would close, and names the path', () => {
    const g = edges(['a', 'b'], ['b', 'c']);
    expect(findCycle(g, 'c', 'a')).toEqual(['a', 'b', 'c', 'a']);
  });

  it('allows an edge that does not close a loop', () => {
    const g = edges(['a', 'b'], ['b', 'c']);
    expect(findCycle(g, 'a', 'c')).toBeNull();
  });

  it('treats a self-edge as a cycle', () => {
    expect(findCycle([], 'a', 'a')).toEqual(['a', 'a']);
  });

  it('allows a diamond, which converges but never returns', () => {
    const g = edges(['bottom', 'left'], ['bottom', 'right'], ['left', 'top']);
    expect(findCycle(g, 'right', 'top')).toBeNull();
  });

  it('never reports a cycle in a forest, however it is shaped', () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 30 }), { maxLength: 30 }), (parents) => {
        // Node i points only at a lower index, so the graph cannot loop.
        const g: Edge[] = [];
        parents.forEach((p, i) => {
          const parent = p % (i + 1);
          if (parent !== i) g.push({ fromId: `n${i}`, toId: `n${parent}` });
        });
        return g.every((e) => findCycle(g.filter((x) => x !== e), e.fromId, e.toId) === null);
      }),
    );
  });
});
