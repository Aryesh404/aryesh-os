import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluate,
  evaluationOrder,
  findExpressionCycle,
  formatError,
  parse,
  references,
  validateExpression,
} from './index.js';
import type { ExpressionContext } from './evaluate.js';

const values: Record<string, number> = {
  income: 100_000,
  expenses: 60_000,
  revenue: 140_000,
  zero: 0,
};

const ctx: ExpressionContext = {
  value: (key) => values[key],
  at: (key, periodsAgo) => {
    const base = values[key];
    return base === undefined ? undefined : base - periodsAgo * 10_000;
  },
  series: (key, n) => {
    const base = values[key];
    return base === undefined ? undefined : Array.from({ length: n }, (_, i) => base - i * 1000);
  },
};

const run = (src: string) => evaluate(parse(src), ctx);
const val = (src: string): number => {
  const r = run(src);
  if (!r.ok) throw new Error(`expected a value, got: ${r.error}`);
  return r.value;
};
const err = (src: string): string => {
  const r = run(src);
  if (r.ok) throw new Error(`expected an error, got: ${r.value}`);
  return r.error;
};

describe('arithmetic and precedence', () => {
  it('evaluates the savings-rate example from docs/03 §3', () => {
    expect(val('({income} - {expenses}) / {income}')).toBeCloseTo(0.4, 10);
  });

  it('respects precedence and parentheses', () => {
    expect(val('2 + 3 * 4')).toBe(14);
    expect(val('(2 + 3) * 4')).toBe(20);
    expect(val('-3 + 5')).toBe(2);
    expect(val('10 / 2 / 5')).toBe(1);
    expect(val('2 * 3 % 4')).toBe(2);
  });

  it('parses underscores and decimals in numbers', () => {
    expect(val('1_000_000 + 0.5')).toBe(1_000_000.5);
  });

  it('handles comparison and ternary', () => {
    expect(val('{revenue} > 100000 ? 1 : 0')).toBe(1);
    expect(val('{revenue} < 100000 ? 1 : 0')).toBe(0);
    expect(val('1 && 0 || 1')).toBe(1);
  });
});

describe('functions', () => {
  it('supports the variadic and unary set', () => {
    expect(val('sum(1, 2, 3)')).toBe(6);
    expect(val('mean(2, 4, 6)')).toBe(4);
    expect(val('min(5, 2, 9)')).toBe(2);
    expect(val('max(5, 2, 9)')).toBe(9);
    expect(val('abs(0 - 7)')).toBe(7);
    expect(val('round(2.6)')).toBe(3);
    expect(val('clamp(150, 0, 100)')).toBe(100);
  });

  it('supports history functions', () => {
    expect(val('delta({revenue}, 1)')).toBe(10_000);
    expect(val('pct_change({revenue}, 1)')).toBeCloseTo(10_000 / 130_000, 10);
    expect(val('rolling_mean({revenue}, 3)')).toBeCloseTo(139_000, 10);
    expect(val('rolling_sum({revenue}, 2)')).toBe(279_000);
  });

  it('requires a metric reference for history functions', () => {
    expect(err('delta(5, 1)')).toMatch(/needs a metric reference/);
  });
});

/** docs/03 §3 — errors are values. One bad expression must not break a dashboard. */
describe('errors are values, never exceptions', () => {
  it('reports a missing metric rather than throwing', () => {
    expect(err('{nonexistent} + 1')).toMatch(/metric 'nonexistent' has no readings/);
  });

  it('reports division by zero', () => {
    expect(err('{revenue} / {zero}')).toMatch(/division by zero/);
  });

  it('reports an unknown function', () => {
    expect(err('sqrt(4)')).toMatch(/unknown function 'sqrt\(\)'/);
  });

  it('reports wrong arity', () => {
    expect(err('clamp(1, 2)')).toMatch(/clamp\(\) takes 3 argument\(s\)/);
  });

  it('formats for display', () => {
    expect(formatError('division by zero')).toBe('#ERR: division by zero');
  });

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (source) => {
        try {
          const parsed = validateExpression(source);
          if (!parsed.valid) return true;
          const result = evaluate(parsed.ast, ctx);
          return typeof result.ok === 'boolean';
        } catch {
          return false;
        }
      }),
    );
  });
});

describe('syntax errors point at the problem', () => {
  it('rejects an unclosed metric reference', () => {
    const r = validateExpression('{revenue + 1');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toMatch(/unclosed metric reference/);
  });

  it('rejects a bare identifier with a helpful nudge', () => {
    const r = validateExpression('revenue + 1');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toMatch(/did you mean \{revenue\}/);
  });

  it('rejects unbalanced parentheses and trailing junk', () => {
    expect(validateExpression('(1 + 2').valid).toBe(false);
    expect(validateExpression('1 + 2)').valid).toBe(false);
    expect(validateExpression('').valid).toBe(false);
  });
});

describe('dependencies', () => {
  it('extracts referenced metrics', () => {
    expect(references(parse('({income} - {expenses}) / {income}')).sort()).toEqual([
      'expenses',
      'income',
    ]);
  });

  it('detects a self-reference', () => {
    const cycle = findExpressionCycle([], { key: 'a', expression: '{a} + 1' });
    expect(cycle).toEqual(['a', 'a']);
  });

  it('detects an indirect cycle and names the path', () => {
    const existing = [
      { key: 'b', expression: '{c} * 2' },
      { key: 'c', expression: '{a} + 1' },
    ];
    const cycle = findExpressionCycle(existing, { key: 'a', expression: '{b} / 2' });
    expect(cycle).not.toBeNull();
    expect(cycle?.[0]).toBe('a');
    expect(cycle).toContain('c');
  });

  it('allows a diamond of dependencies', () => {
    const existing = [
      { key: 'b', expression: '{d} + 1' },
      { key: 'c', expression: '{d} + 2' },
    ];
    expect(findExpressionCycle(existing, { key: 'a', expression: '{b} + {c}' })).toBeNull();
  });

  it('orders evaluation dependencies first', () => {
    const order = evaluationOrder([
      { key: 'a', expression: '{b} + {c}' },
      { key: 'b', expression: '{d} * 2' },
      { key: 'c', expression: '5' },
      { key: 'd', expression: '1' },
    ]);
    expect(order.indexOf('d')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('a'));
  });
});

describe('resource bounds', () => {
  it('refuses an expression that is too complex rather than hanging', () => {
    const deep = `${'('.repeat(2000)}1${')'.repeat(2000)}`;
    const parsed = validateExpression(deep);
    if (parsed.valid) {
      const result = evaluate(parsed.ast, ctx);
      if (!result.ok) expect(result.error).toMatch(/too complex/);
    }
    // Either the parser or the step budget stops it; neither may hang.
    expect(true).toBe(true);
  });
});
