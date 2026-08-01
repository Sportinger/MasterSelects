export const MOTION_EXPRESSION_VERSION = 1 as const;

export const MOTION_EXPRESSION_BUDGETS = {
  maxSourceLength: 512,
  maxTokens: 128,
  maxAstNodes: 64,
  maxAstDepth: 24,
  maxEvaluationSteps: 48,
} as const;

export const MOTION_EXPRESSION_PRECEDENCE = 'expression-over-keyframe' as const;

export const MOTION_EXPRESSION_ERROR_CODES = {
  SOURCE_INVALID: 'MD8_EXPRESSION_SOURCE_INVALID',
  SOURCE_BUDGET_EXCEEDED: 'MD8_EXPRESSION_SOURCE_BUDGET_EXCEEDED',
  TOKEN_INVALID: 'MD8_EXPRESSION_TOKEN_INVALID',
  TOKEN_BUDGET_EXCEEDED: 'MD8_EXPRESSION_TOKEN_BUDGET_EXCEEDED',
  PARSE_ERROR: 'MD8_EXPRESSION_PARSE_ERROR',
  AST_BUDGET_EXCEEDED: 'MD8_EXPRESSION_AST_BUDGET_EXCEEDED',
  IDENTIFIER_FORBIDDEN: 'MD8_EXPRESSION_IDENTIFIER_FORBIDDEN',
  CALL_FORBIDDEN: 'MD8_EXPRESSION_CALL_FORBIDDEN',
  CALL_SIGNATURE_INVALID: 'MD8_EXPRESSION_CALL_SIGNATURE_INVALID',
  PROGRAM_INVALID: 'MD8_EXPRESSION_PROGRAM_INVALID',
  CONTEXT_INVALID: 'MD8_EXPRESSION_CONTEXT_INVALID',
  EVALUATION_BUDGET_EXCEEDED: 'MD8_EXPRESSION_EVALUATION_BUDGET_EXCEEDED',
  NON_FINITE_OUTPUT: 'MD8_EXPRESSION_NON_FINITE_OUTPUT',
  FALLBACK_INVALID: 'MD8_EXPRESSION_FALLBACK_INVALID',
} as const;

export type MotionExpressionErrorCode =
  (typeof MOTION_EXPRESSION_ERROR_CODES)[keyof typeof MOTION_EXPRESSION_ERROR_CODES];

export interface MotionExpressionFailure {
  readonly code: MotionExpressionErrorCode;
  readonly position: number;
  readonly message: string;
}

export type MotionExpressionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failures: readonly MotionExpressionFailure[] };

export type MotionExpressionTokenType =
  | 'number'
  | 'identifier'
  | 'plus'
  | 'minus'
  | 'star'
  | 'slash'
  | 'percent'
  | 'left-paren'
  | 'right-paren'
  | 'comma'
  | 'eof';

export interface MotionExpressionToken {
  readonly type: MotionExpressionTokenType;
  readonly lexeme: string;
  readonly position: number;
  readonly numericValue?: number;
}

export type MotionExpressionAstNode =
  | {
      readonly type: 'number';
      readonly value: number;
      readonly position: number;
    }
  | {
      readonly type: 'variable';
      readonly name: string;
      readonly position: number;
    }
  | {
      readonly type: 'unary';
      readonly operator: '+' | '-';
      readonly argument: MotionExpressionAstNode;
      readonly position: number;
    }
  | {
      readonly type: 'binary';
      readonly operator: '+' | '-' | '*' | '/' | '%';
      readonly left: MotionExpressionAstNode;
      readonly right: MotionExpressionAstNode;
      readonly position: number;
    }
  | {
      readonly type: 'call';
      readonly name: string;
      readonly arguments: readonly MotionExpressionAstNode[];
      readonly position: number;
    };

export interface MotionExpressionProgramV1 {
  readonly version: typeof MOTION_EXPRESSION_VERSION;
  readonly source: string;
  readonly ast: MotionExpressionAstNode;
  readonly tokenCount: number;
  readonly astNodeCount: number;
}

export interface MotionExpressionContext {
  /** Clip-local time in seconds. */
  readonly time: number;
  /** Zero-based instance index. */
  readonly index: number;
  /** Effective, post-limit instance count. */
  readonly count: number;
}

export interface MotionExpressionResolvedValue {
  readonly value: number;
  readonly source: 'expression' | 'keyframe' | 'base';
  readonly precedence: typeof MOTION_EXPRESSION_PRECEDENCE;
}
