import { clamp } from '../math.js';
import type { Node } from './parse.js';

/**
 * docs/03 §3 — errors are values, never exceptions. One bad expression must not
 * break a dashboard, so evaluation returns a failure the caller can render in
 * place of a number.
 */
export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

export interface ExpressionContext {
  /** Latest value of a metric, or undefined when it has no readings. */
  value(key: string): number | undefined;
  /** Value `periodsAgo` cadence periods back, for delta and pct_change. */
  at?(key: string, periodsAgo: number): number | undefined;
  /** The last `n` values, oldest first, for the rolling functions. */
  series?(key: string, n: number): number[] | undefined;
}

/** Guards against a pathological expression burning the event loop. */
const STEP_BUDGET = 10_000;

class Bail extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

// The variable itself needs the annotation, not just the arrow's return type:
// TS only narrows control flow through a never-returning call when the
// identifier is explicitly typed.
const fail: (reason: string) => never = (reason) => {
  throw new Bail(reason);
};

const VARIADIC = new Set(['sum', 'mean', 'min', 'max']);
const SERIES_FNS = new Set(['delta', 'pct_change', 'rolling_mean', 'rolling_sum']);

export function evaluate(node: Node, ctx: ExpressionContext): EvalResult {
  let steps = 0;

  const metricKey = (n: Node, fn: string): string =>
    n.type === 'metric'
      ? n.key
      : fail(`${fn}() needs a metric reference as its first argument, e.g. {revenue}`);

  const walk = (n: Node): number => {
    if (++steps > STEP_BUDGET) fail('expression is too complex to evaluate');

    switch (n.type) {
      case 'number':
        return n.value;

      case 'metric': {
        const value = ctx.value(n.key);
        if (value === undefined) fail(`metric '${n.key}' has no readings`);
        if (!Number.isFinite(value)) fail(`metric '${n.key}' has no usable value`);
        return value as number;
      }

      case 'unary':
        return -walk(n.operand);

      case 'binary': {
        const left = walk(n.left);
        const right = walk(n.right);
        switch (n.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return right === 0 ? fail('division by zero') : left / right;
          case '%':
            return right === 0 ? fail('modulo by zero') : left % right;
          case '<':
            return left < right ? 1 : 0;
          case '<=':
            return left <= right ? 1 : 0;
          case '>':
            return left > right ? 1 : 0;
          case '>=':
            return left >= right ? 1 : 0;
          case '==':
            return left === right ? 1 : 0;
          case '!=':
            return left !== right ? 1 : 0;
          case '&&':
            return left !== 0 && right !== 0 ? 1 : 0;
          case '||':
            return left !== 0 || right !== 0 ? 1 : 0;
          default:
            return fail(`unknown operator '${n.op}'`);
        }
      }

      case 'ternary':
        return walk(n.condition) !== 0 ? walk(n.whenTrue) : walk(n.whenFalse);

      case 'call': {
        const { name, args } = n;

        if (SERIES_FNS.has(name)) {
          const key = metricKey(args[0] as Node, name);
          const n1 = args[1] === undefined ? 1 : walk(args[1] as Node);
          if (!Number.isInteger(n1) || n1 < 1) {
            fail(`${name}() needs a whole number of periods`);
          }

          if (name === 'delta' || name === 'pct_change') {
            if (ctx.at === undefined) fail(`${name}() needs metric history`);
            const current = ctx.value(key);
            const past = ctx.at(key, n1);
            if (current === undefined) fail(`metric '${key}' has no readings`);
            if (past === undefined) fail(`metric '${key}' has no value ${n1} period(s) back`);
            if (name === 'delta') return (current as number) - (past as number);
            if (past === 0) fail(`pct_change() on '${key}' divides by a zero baseline`);
            return ((current as number) - (past as number)) / Math.abs(past as number);
          }

          if (ctx.series === undefined) fail(`${name}() needs metric history`);
          const series = ctx.series(key, n1);
          if (series === undefined || series.length === 0) {
            fail(`metric '${key}' has no history for ${name}()`);
          }
          const values = series as number[];
          const total = values.reduce((a, b) => a + b, 0);
          return name === 'rolling_sum' ? total : total / values.length;
        }

        const evaluated = args.map(walk);

        if (VARIADIC.has(name)) {
          if (evaluated.length === 0) fail(`${name}() needs at least one argument`);
          switch (name) {
            case 'sum':
              return evaluated.reduce((a, b) => a + b, 0);
            case 'mean':
              return evaluated.reduce((a, b) => a + b, 0) / evaluated.length;
            case 'min':
              return Math.min(...evaluated);
            case 'max':
              return Math.max(...evaluated);
          }
        }

        switch (name) {
          case 'abs':
            return Math.abs(expectArity(evaluated, 1, name)[0] as number);
          case 'round':
            return Math.round(expectArity(evaluated, 1, name)[0] as number);
          case 'floor':
            return Math.floor(expectArity(evaluated, 1, name)[0] as number);
          case 'ceil':
            return Math.ceil(expectArity(evaluated, 1, name)[0] as number);
          case 'clamp': {
            const [x, lo, hi] = expectArity(evaluated, 3, name);
            return clamp(x as number, lo as number, hi as number);
          }
          default:
            return fail(`unknown function '${name}()'`);
        }
      }
    }
  };

  const expectArity = (args: number[], arity: number, name: string): number[] =>
    args.length === arity ? args : fail(`${name}() takes ${arity} argument(s)`);

  try {
    const value = walk(node);
    if (!Number.isFinite(value)) {
      return { ok: false, error: 'result is not a finite number' };
    }
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Bail) return { ok: false, error: err.reason };
    throw err;
  }
}

/** Rendered in place of a value, so a broken expression is visibly broken. */
export function formatError(error: string): string {
  return `#ERR: ${error}`;
}
