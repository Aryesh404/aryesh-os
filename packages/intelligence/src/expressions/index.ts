import { findPath } from '@aryesh/domain';
import { parse, references, type Node } from './parse.js';
import { ExpressionSyntaxError } from './tokenize.js';
import {
  evaluate,
  formatError,
  type EvalResult,
  type ExpressionContext,
} from './evaluate.js';

export { parse, references, evaluate, formatError, ExpressionSyntaxError };
export type { Node, EvalResult, ExpressionContext };
export type { Token, TokenType } from './tokenize.js';

export interface DerivedMetricDef {
  key: string;
  expression: string;
}

export type ValidationResult =
  | { valid: true; ast: Node; dependsOn: string[] }
  | { valid: false; error: string; pos?: number };

/** Parse-time check, run when a derived metric is saved. */
export function validateExpression(source: string): ValidationResult {
  try {
    const ast = parse(source);
    return { valid: true, ast, dependsOn: references(ast) };
  } catch (err) {
    if (err instanceof ExpressionSyntaxError) {
      return { valid: false, error: err.message, pos: err.pos };
    }
    throw err;
  }
}

/**
 * docs/03 §3 — the dependency graph is maintained at save time and cycles are
 * rejected with the path shown, so a derived metric can never quietly depend on
 * itself and evaluate forever.
 */
export function findExpressionCycle(
  defs: readonly DerivedMetricDef[],
  candidate: DerivedMetricDef,
): string[] | null {
  const edges: Array<{ fromId: string; toId: string }> = [];

  for (const def of [...defs.filter((d) => d.key !== candidate.key), candidate]) {
    const parsed = validateExpression(def.expression);
    if (!parsed.valid) continue;
    for (const dep of parsed.dependsOn) {
      edges.push({ fromId: def.key, toId: dep });
    }
  }

  const parsed = validateExpression(candidate.expression);
  if (!parsed.valid) return null;

  if (parsed.dependsOn.includes(candidate.key)) return [candidate.key, candidate.key];

  for (const dep of parsed.dependsOn) {
    const back = findPath(edges, dep, candidate.key);
    if (back) return [candidate.key, ...back];
  }
  return null;
}

/** Evaluation order for a set of derived metrics, dependencies first. */
export function evaluationOrder(defs: readonly DerivedMetricDef[]): string[] {
  const deps = new Map<string, string[]>();
  for (const def of defs) {
    const parsed = validateExpression(def.expression);
    deps.set(def.key, parsed.valid ? parsed.dependsOn : []);
  }

  const ordered: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (key: string): void => {
    if (state.get(key) === 'done' || state.get(key) === 'visiting') return;
    state.set(key, 'visiting');
    for (const dep of deps.get(key) ?? []) {
      if (deps.has(dep)) visit(dep);
    }
    state.set(key, 'done');
    ordered.push(key);
  };

  for (const def of defs) visit(def.key);
  return ordered;
}
