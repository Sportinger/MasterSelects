type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' | '^' }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma'; value: ',' }
  | { type: 'eof' };

type AstNode =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  | { type: 'unary'; op: '+' | '-'; value: AstNode }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: AstNode; right: AstNode }
  | { type: 'call'; name: string; args: AstNode[] };

export interface CompiledExpression {
  expression: string;
  evaluate: (variables: Record<string, number>) => number;
}

const FUNCTIONS: Record<string, (...values: number[]) => number> = {
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  log: Math.log,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

const CONSTANTS: Record<string, number> = {
  e: Math.E,
  pi: Math.PI,
};

class Lexer {
  private index = 0;
  private readonly input: string;

  constructor(input: string) {
    this.input = input;
  }

  next(): Token {
    this.skipWhitespace();
    if (this.index >= this.input.length) return { type: 'eof' };

    const char = this.input[this.index];

    if (/\d|\./.test(char)) {
      return this.readNumber();
    }

    if (/[A-Za-z_]/.test(char)) {
      return this.readIdentifier();
    }

    this.index += 1;

    if (char === ',') return { type: 'comma', value: ',' };
    if (char === '(' || char === ')') return { type: 'paren', value: char };
    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '^') {
      return { type: 'operator', value: char };
    }

    throw new Error(`Unexpected token "${char}"`);
  }

  private skipWhitespace(): void {
    while (this.index < this.input.length && /\s/.test(this.input[this.index])) {
      this.index += 1;
    }
  }

  private readNumber(): Token {
    const start = this.index;
    while (this.index < this.input.length && /[\d.]/.test(this.input[this.index])) {
      this.index += 1;
    }

    if (/[eE]/.test(this.input[this.index] ?? '')) {
      this.index += 1;
      if (/[+-]/.test(this.input[this.index] ?? '')) {
        this.index += 1;
      }
      while (this.index < this.input.length && /\d/.test(this.input[this.index])) {
        this.index += 1;
      }
    }

    const value = Number(this.input.slice(start, this.index));
    if (!Number.isFinite(value)) {
      throw new Error('Invalid number');
    }
    return { type: 'number', value };
  }

  private readIdentifier(): Token {
    const start = this.index;
    while (this.index < this.input.length && /[A-Za-z0-9_]/.test(this.input[this.index])) {
      this.index += 1;
    }
    return { type: 'identifier', value: this.input.slice(start, this.index).toLowerCase() };
  }
}

class Parser {
  private readonly lexer: Lexer;
  private current: Token;

  constructor(input: string) {
    this.lexer = new Lexer(input);
    this.current = this.lexer.next();
  }

  parse(): AstNode {
    const expression = this.parseAdditive();
    if (this.current.type !== 'eof') {
      throw new Error('Unexpected trailing expression');
    }
    return expression;
  }

  private consume(): Token {
    const token = this.current;
    this.current = this.lexer.next();
    return token;
  }

  private consumeOperator<T extends '+' | '-' | '*' | '/' | '^'>(operators: readonly T[]): T {
    const token = this.current;
    if (token.type !== 'operator' || !operators.includes(token.value as T)) {
      throw new Error('Expected operator');
    }
    this.consume();
    return token.value as T;
  }

  private consumeNumber(): number {
    const token = this.current;
    if (token.type !== 'number') {
      throw new Error('Expected number');
    }
    this.consume();
    return token.value;
  }

  private consumeIdentifier(): string {
    const token = this.current;
    if (token.type !== 'identifier') {
      throw new Error('Expected identifier');
    }
    this.consume();
    return token.value;
  }

  private isOpenParen(): boolean {
    return this.current.type === 'paren' && this.current.value === '(';
  }

  private isCloseParen(): boolean {
    return this.current.type === 'paren' && this.current.value === ')';
  }

  private isComma(): boolean {
    return this.current.type === 'comma';
  }

  private parseAdditive(): AstNode {
    let node = this.parseMultiplicative();
    while (this.current.type === 'operator' && (this.current.value === '+' || this.current.value === '-')) {
      const op = this.consumeOperator(['+', '-'] as const);
      node = { type: 'binary', op, left: node, right: this.parseMultiplicative() };
    }
    return node;
  }

  private parseMultiplicative(): AstNode {
    let node = this.parsePower();
    while (this.current.type === 'operator' && (this.current.value === '*' || this.current.value === '/')) {
      const op = this.consumeOperator(['*', '/'] as const);
      node = { type: 'binary', op, left: node, right: this.parsePower() };
    }
    return node;
  }

  private parsePower(): AstNode {
    let node = this.parseUnary();
    if (this.current.type === 'operator' && this.current.value === '^') {
      this.consume();
      node = { type: 'binary', op: '^', left: node, right: this.parsePower() };
    }
    return node;
  }

  private parseUnary(): AstNode {
    if (this.current.type === 'operator' && (this.current.value === '+' || this.current.value === '-')) {
      const op = this.consumeOperator(['+', '-'] as const);
      return { type: 'unary', op, value: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    if (this.current.type === 'number') {
      return { type: 'number', value: this.consumeNumber() };
    }

    if (this.current.type === 'identifier') {
      const name = this.consumeIdentifier();
      if (this.isOpenParen()) {
        this.consume();
        const args: AstNode[] = [];
        if (!this.isCloseParen()) {
          while (!this.isCloseParen()) {
            args.push(this.parseAdditive());
            if (!this.isComma()) break;
            this.consume();
          }
        }
        if (!this.isCloseParen()) {
          throw new Error('Expected closing parenthesis');
        }
        this.consume();
        return { type: 'call', name, args };
      }

      return { type: 'variable', name };
    }

    if (this.isOpenParen()) {
      this.consume();
      const expression = this.parseAdditive();
      if (!this.isCloseParen()) {
        throw new Error('Expected closing parenthesis');
      }
      this.consume();
      return expression;
    }

    throw new Error('Expected expression');
  }
}

function evaluateAst(node: AstNode, variables: Record<string, number>): number {
  switch (node.type) {
    case 'number':
      return node.value;
    case 'variable': {
      if (node.name in variables) return variables[node.name];
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      throw new Error(`Unknown variable "${node.name}"`);
    }
    case 'unary': {
      const value = evaluateAst(node.value, variables);
      return node.op === '-' ? -value : value;
    }
    case 'binary': {
      const left = evaluateAst(node.left, variables);
      const right = evaluateAst(node.right, variables);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
        case '^': return Math.pow(left, right);
        default: throw new Error('Unsupported operator');
      }
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) {
        throw new Error(`Unknown function "${node.name}"`);
      }
      return fn(...node.args.map((arg) => evaluateAst(arg, variables)));
    }
  }
}

export function compileExpression(expression: string): CompiledExpression {
  const ast = new Parser(expression.trim() || '0').parse();
  return {
    expression,
    evaluate: (variables) => evaluateAst(ast, variables),
  };
}
