import {
  MOTION_EXPRESSION_BUDGETS,
  MOTION_EXPRESSION_ERROR_CODES,
  type MotionExpressionAstNode,
  type MotionExpressionFailure,
  type MotionExpressionResult,
  type MotionExpressionToken,
  type MotionExpressionTokenType,
} from './contracts';
import { inspectDenseDataArray, inspectExactDataRecord } from './boundarySafety';

const TOKEN_KEYS = new Set(['type', 'lexeme', 'position', 'numericValue']);
const TOKEN_REQUIRED_KEYS = new Set(['type', 'lexeme', 'position']);

interface ParsedMotionExpression {
  readonly ast: MotionExpressionAstNode;
  readonly astNodeCount: number;
}

class MotionExpressionParser {
  private cursor = 0;
  private nodeCount = 0;
  private depth = 0;
  private readonly tokens: readonly MotionExpressionToken[];

  constructor(tokens: readonly MotionExpressionToken[]) {
    this.tokens = tokens;
  }

  parse(): MotionExpressionResult<ParsedMotionExpression> {
    try {
      const ast = this.parseAdditive();
      if (this.peek().type !== 'eof') {
        return this.error(this.peek(), 'Unexpected token after the expression.');
      }
      return { ok: true, value: { ast, astNodeCount: this.nodeCount } };
    } catch (error) {
      if (isParserFailure(error)) return { ok: false, failures: [error.failure] };
      return this.error(this.peek(), 'Expression could not be parsed safely.');
    }
  }

  private createNode<T extends MotionExpressionAstNode>(node: T): T {
    this.nodeCount += 1;
    if (this.nodeCount > MOTION_EXPRESSION_BUDGETS.maxAstNodes) {
      throw parserFailure({
        code: MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED,
        position: node.position,
        message: 'Expression exceeds the AST node budget.',
      });
    }
    return node;
  }

  private withDepth<T>(position: number, callback: () => T): T {
    this.depth += 1;
    if (this.depth > MOTION_EXPRESSION_BUDGETS.maxAstDepth) {
      throw parserFailure({
        code: MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED,
        position,
        message: 'Expression exceeds the AST depth budget.',
      });
    }
    try {
      return callback();
    } finally {
      this.depth -= 1;
    }
  }

  private parseAdditive(): MotionExpressionAstNode {
    let node = this.parseMultiplicative();
    while (this.match('plus') || this.match('minus')) {
      const operator = this.previous();
      const right = this.parseMultiplicative();
      node = this.createNode({
        type: 'binary',
        operator: operator.type === 'plus' ? '+' : '-',
        left: node,
        right,
        position: operator.position,
      });
    }
    return node;
  }

  private parseMultiplicative(): MotionExpressionAstNode {
    let node = this.parseUnary();
    while (this.match('star') || this.match('slash') || this.match('percent')) {
      const operator = this.previous();
      const right = this.parseUnary();
      node = this.createNode({
        type: 'binary',
        operator: operator.type === 'star' ? '*' : operator.type === 'slash' ? '/' : '%',
        left: node,
        right,
        position: operator.position,
      });
    }
    return node;
  }

  private parseUnary(): MotionExpressionAstNode {
    if (this.match('plus') || this.match('minus')) {
      const operator = this.previous();
      return this.withDepth(operator.position, () => this.createNode({
        type: 'unary',
        operator: operator.type === 'plus' ? '+' : '-',
        argument: this.parseUnary(),
        position: operator.position,
      }));
    }
    return this.parsePrimary();
  }

  private parsePrimary(): MotionExpressionAstNode {
    const token = this.peek();
    if (this.match('number')) {
      return this.createNode({
        type: 'number',
        value: token.numericValue!,
        position: token.position,
      });
    }
    if (this.match('identifier')) {
      if (!this.match('left-paren')) {
        return this.createNode({ type: 'variable', name: token.lexeme, position: token.position });
      }
      return this.withDepth(token.position, () => {
        const args: MotionExpressionAstNode[] = [];
        if (this.peek().type !== 'right-paren') {
          do {
            args.push(this.parseAdditive());
          } while (this.match('comma'));
        }
        this.consume('right-paren', 'Function call is missing a closing parenthesis.');
        return this.createNode({
          type: 'call',
          name: token.lexeme,
          arguments: args,
          position: token.position,
        });
      });
    }
    if (this.match('left-paren')) {
      return this.withDepth(token.position, () => {
        const node = this.parseAdditive();
        this.consume('right-paren', 'Grouping is missing a closing parenthesis.');
        return node;
      });
    }
    throw parserFailure({
      code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
      position: token.position,
      message: 'Expected a number, variable, function call, or grouped expression.',
    });
  }

  private match(type: MotionExpressionTokenType): boolean {
    if (this.peek().type !== type) return false;
    this.cursor += 1;
    return true;
  }

  private consume(type: MotionExpressionTokenType, message: string): void {
    if (!this.match(type)) {
      throw parserFailure({
        code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
        position: this.peek().position,
        message,
      });
    }
  }

  private peek(): MotionExpressionToken {
    return this.tokens[this.cursor] ?? this.tokens[this.tokens.length - 1];
  }

  private previous(): MotionExpressionToken {
    return this.tokens[this.cursor - 1];
  }

  private error<T>(token: MotionExpressionToken, message: string): MotionExpressionResult<T> {
    return {
      ok: false,
      failures: [{ code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR, position: token.position, message }],
    };
  }
}

interface ParserFailureWrapper {
  readonly marker: 'motion-expression-parser-failure';
  readonly failure: MotionExpressionFailure;
}

function parserFailure(failure: MotionExpressionFailure): ParserFailureWrapper {
  return { marker: 'motion-expression-parser-failure', failure };
}

function isParserFailure(value: unknown): value is ParserFailureWrapper {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as Partial<ParserFailureWrapper>).marker === 'motion-expression-parser-failure',
  );
}

export function parseMotionExpressionTokens(
  tokens: unknown,
): MotionExpressionResult<ParsedMotionExpression> {
  const tokenTypes = new Set<MotionExpressionTokenType>([
    'number', 'identifier', 'plus', 'minus', 'star', 'slash', 'percent',
    'left-paren', 'right-paren', 'comma', 'eof',
  ]);
  const tokenArray = inspectDenseDataArray(tokens, MOTION_EXPRESSION_BUDGETS.maxTokens + 1);
  if (!tokenArray.ok || tokenArray.values.length === 0) {
    return {
      ok: false,
      failures: [{
        code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
        position: 0,
        message: 'Parser requires a complete token stream.',
      }],
    };
  }
  const safeTokens: MotionExpressionToken[] = [];
  for (let index = 0; index < tokenArray.values.length; index += 1) {
    const token = inspectExactDataRecord(
      tokenArray.values[index],
      TOKEN_KEYS,
      TOKEN_REQUIRED_KEYS,
    );
    if (!token) {
      return {
        ok: false,
        failures: [{
          code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
          position: 0,
          message: 'Parser tokens must be exact inert objects.',
        }],
      };
    }
    const type = token.descriptors.type.value;
    const lexeme = token.descriptors.lexeme.value;
    const position = token.descriptors.position.value;
    const numericValue = token.descriptors.numericValue?.value;
    if (
      typeof type !== 'string' ||
      !tokenTypes.has(type as MotionExpressionTokenType) ||
      typeof lexeme !== 'string' ||
      !Number.isSafeInteger(position) ||
      (position as number) < 0 ||
      (type === 'number' && (typeof numericValue !== 'number' || !Number.isFinite(numericValue))) ||
      (type !== 'number' && numericValue !== undefined) ||
      (type === 'eof' && index !== tokenArray.values.length - 1)
    ) {
      return {
        ok: false,
        failures: [{
          code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
          position: 0,
          message: 'Parser requires a complete canonical token stream.',
        }],
      };
    }
    safeTokens.push({
      type: type as MotionExpressionTokenType,
      lexeme,
      position: position as number,
      ...(typeof numericValue === 'number' ? { numericValue } : {}),
    });
  }
  if (safeTokens[safeTokens.length - 1]?.type !== 'eof') {
    return {
      ok: false,
      failures: [{
        code: MOTION_EXPRESSION_ERROR_CODES.PARSE_ERROR,
        position: 0,
        message: 'Parser requires a complete token stream.',
      }],
    };
  }
  return new MotionExpressionParser(safeTokens).parse();
}
