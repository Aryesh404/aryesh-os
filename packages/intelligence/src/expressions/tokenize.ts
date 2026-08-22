/**
 * docs/03 §3 — a deliberately small language, not general formula fields.
 * No loops, no user-defined functions, no I/O, no strings.
 */

export type TokenType =
  | 'number'
  | 'metric'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'question'
  | 'colon';

export interface Token {
  type: TokenType;
  value: string;
  /** Character offset, so an error can point at the problem. */
  pos: number;
}

export class ExpressionSyntaxError extends Error {
  readonly pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.name = 'ExpressionSyntaxError';
    this.pos = pos;
  }
}

const TWO_CHAR_OPS = new Set(['<=', '>=', '==', '!=', '&&', '||']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>']);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // {metric_key}
    if (ch === '{') {
      const end = input.indexOf('}', i);
      if (end === -1) throw new ExpressionSyntaxError('unclosed metric reference', i);
      const key = input.slice(i + 1, end).trim();
      if (key === '') throw new ExpressionSyntaxError('empty metric reference', i);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        throw new ExpressionSyntaxError(`invalid metric key '${key}'`, i);
      }
      tokens.push({ type: 'metric', value: key, pos: i });
      i = end + 1;
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < input.length && /[0-9_]/.test(input[j] as string)) j++;
      if (input[j] === '.') {
        j++;
        while (j < input.length && /[0-9_]/.test(input[j] as string)) j++;
      }
      tokens.push({ type: 'number', value: input.slice(i, j).replace(/_/g, ''), pos: i });
      i = j;
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j] as string)) j++;
      tokens.push({ type: 'ident', value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPS.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i });
      i++;
      continue;
    }

    switch (ch) {
      case '(':
        tokens.push({ type: 'lparen', value: ch, pos: i++ });
        continue;
      case ')':
        tokens.push({ type: 'rparen', value: ch, pos: i++ });
        continue;
      case ',':
        tokens.push({ type: 'comma', value: ch, pos: i++ });
        continue;
      case '?':
        tokens.push({ type: 'question', value: ch, pos: i++ });
        continue;
      case ':':
        tokens.push({ type: 'colon', value: ch, pos: i++ });
        continue;
      default:
        throw new ExpressionSyntaxError(`unexpected character '${ch}'`, i);
    }
  }

  return tokens;
}
