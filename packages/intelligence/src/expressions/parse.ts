import { ExpressionSyntaxError, tokenize, type Token } from './tokenize.js';

export type Node =
  | { type: 'number'; value: number }
  | { type: 'metric'; key: string }
  | { type: 'unary'; op: '-' | '!'; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'ternary'; condition: Node; whenTrue: Node; whenFalse: Node }
  | { type: 'call'; name: string; args: Node[] };

/** Higher binds tighter. */
const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new ExpressionSyntaxError('unexpected end of expression', this.endPos());
    }
    this.index++;
    return token;
  }

  private endPos(): number {
    const last = this.tokens[this.tokens.length - 1];
    return last ? last.pos + last.value.length : 0;
  }

  private expect(type: Token['type'], what: string): Token {
    const token = this.next();
    if (token.type !== type) {
      throw new ExpressionSyntaxError(`expected ${what}, got '${token.value}'`, token.pos);
    }
    return token;
  }

  parse(): Node {
    const node = this.parseExpression(0);
    const leftover = this.peek();
    if (leftover !== undefined) {
      throw new ExpressionSyntaxError(`unexpected '${leftover.value}'`, leftover.pos);
    }
    return node;
  }

  /** Precedence climbing, with the ternary handled at the lowest level. */
  private parseExpression(minPrecedence: number): Node {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (token === undefined) break;

      if (token.type === 'question' && minPrecedence === 0) {
        this.next();
        const whenTrue = this.parseExpression(0);
        this.expect('colon', "':'");
        const whenFalse = this.parseExpression(0);
        left = { type: 'ternary', condition: left, whenTrue, whenFalse };
        continue;
      }

      if (token.type !== 'op') break;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) break;

      this.next();
      const right = this.parseExpression(precedence + 1);
      left = { type: 'binary', op: token.value, left, right };
    }

    return left;
  }

  private parseUnary(): Node {
    const token = this.peek();
    if (token?.type === 'op' && token.value === '-') {
      this.next();
      return { type: 'unary', op: '-', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.next();

    switch (token.type) {
      case 'number': {
        const value = Number(token.value);
        if (!Number.isFinite(value)) {
          throw new ExpressionSyntaxError(`invalid number '${token.value}'`, token.pos);
        }
        return { type: 'number', value };
      }

      case 'metric':
        return { type: 'metric', key: token.value };

      case 'lparen': {
        const inner = this.parseExpression(0);
        this.expect('rparen', "')'");
        return inner;
      }

      case 'ident': {
        const open = this.peek();
        if (open?.type !== 'lparen') {
          throw new ExpressionSyntaxError(
            `'${token.value}' is not a value — did you mean {${token.value}}?`,
            token.pos,
          );
        }
        this.next();
        const args: Node[] = [];
        if (this.peek()?.type !== 'rparen') {
          for (;;) {
            args.push(this.parseExpression(0));
            if (this.peek()?.type === 'comma') {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expect('rparen', "')'");
        return { type: 'call', name: token.value, args };
      }

      default:
        throw new ExpressionSyntaxError(`unexpected '${token.value}'`, token.pos);
    }
  }
}

export function parse(source: string): Node {
  const tokens = tokenize(source);
  if (tokens.length === 0) throw new ExpressionSyntaxError('empty expression', 0);
  return new Parser(tokens).parse();
}

/** Metric keys an expression depends on. Used to build the dependency graph. */
export function references(node: Node): string[] {
  const found = new Set<string>();
  const walk = (n: Node): void => {
    switch (n.type) {
      case 'metric':
        found.add(n.key);
        return;
      case 'unary':
        walk(n.operand);
        return;
      case 'binary':
        walk(n.left);
        walk(n.right);
        return;
      case 'ternary':
        walk(n.condition);
        walk(n.whenTrue);
        walk(n.whenFalse);
        return;
      case 'call':
        n.args.forEach(walk);
        return;
      case 'number':
        return;
    }
  };
  walk(node);
  return [...found];
}
