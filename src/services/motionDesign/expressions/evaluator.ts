import {
  MOTION_EXPRESSION_BUDGETS,
  MOTION_EXPRESSION_ERROR_CODES,
  MOTION_EXPRESSION_PRECEDENCE,
  type MotionExpressionAstNode,
  type MotionExpressionContext,
  type MotionExpressionFailure,
  type MotionExpressionProgramV1,
  type MotionExpressionResolvedValue,
  type MotionExpressionResult,
} from './contracts';
import { validateMotionExpressionProgram } from './validator';
import { inspectExactDataRecord } from './boundarySafety';

const CONTEXT_KEYS = new Set(['time', 'index', 'count']);
const RESOLVE_INPUT_KEYS = new Set([
  'program',
  'context',
  'keyframedValue',
  'baseValue',
]);
const RESOLVE_INPUT_REQUIRED_KEYS = new Set(['context', 'baseValue']);

function failure(
  code: MotionExpressionFailure['code'],
  position: number,
  message: string,
): MotionExpressionFailure {
  return { code, position, message };
}

function inspectContext(value: unknown): MotionExpressionContext | null {
  const context = inspectExactDataRecord(value, CONTEXT_KEYS);
  if (!context) return null;
  const time = context.descriptors.time.value;
  const index = context.descriptors.index.value;
  const count = context.descriptors.count.value;
  if (
    typeof time !== 'number' ||
    !Number.isFinite(time) ||
    !Number.isSafeInteger(index) ||
    (index as number) < 0 ||
    !Number.isSafeInteger(count) ||
    (count as number) <= 0 ||
    (count as number) > 0x1_0000_0000 ||
    (index as number) >= (count as number)
  ) {
    return null;
  }
  return { time, index: index as number, count: count as number };
}

export function deterministicMotionExpressionRandom(seed: number, index: number): number {
  let value = (seed >>> 0) ^ Math.imul((index >>> 0) + 1, 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function evaluateMotionExpression(
  program: unknown,
  context: unknown,
): MotionExpressionResult<number> {
  const validated = validateMotionExpressionProgram(program);
  if (!validated.ok) return validated;
  const safeContext = inspectContext(context);
  if (!safeContext) {
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.CONTEXT_INVALID,
        0,
        'Expression context requires finite clip-local time, zero-based index, and positive effective count.',
      )],
    };
  }

  let steps = 0;
  const evaluateNode = (node: MotionExpressionAstNode): MotionExpressionResult<number> => {
    steps += 1;
    if (steps > MOTION_EXPRESSION_BUDGETS.maxEvaluationSteps) {
      return {
        ok: false,
        failures: [failure(
          MOTION_EXPRESSION_ERROR_CODES.EVALUATION_BUDGET_EXCEEDED,
          node.position,
          'Expression exceeds the evaluation-step budget.',
        )],
      };
    }
    let value: number;
    if (node.type === 'number') {
      value = node.value;
    } else if (node.type === 'variable') {
      value = safeContext[node.name as keyof MotionExpressionContext];
    } else if (node.type === 'unary') {
      const argument = evaluateNode(node.argument);
      if (!argument.ok) return argument;
      value = node.operator === '-' ? -argument.value : argument.value;
    } else if (node.type === 'binary') {
      const left = evaluateNode(node.left);
      if (!left.ok) return left;
      const right = evaluateNode(node.right);
      if (!right.ok) return right;
      switch (node.operator) {
        case '+': value = left.value + right.value; break;
        case '-': value = left.value - right.value; break;
        case '*': value = left.value * right.value; break;
        case '/': value = left.value / right.value; break;
        case '%': value = left.value % right.value; break;
      }
    } else {
      const args: number[] = [];
      for (const argumentNode of node.arguments) {
        const argument = evaluateNode(argumentNode);
        if (!argument.ok) return argument;
        args.push(argument.value);
      }
      value = node.name === 'sin'
        ? Math.sin(args[0])
        : node.name === 'cos'
          ? Math.cos(args[0])
          : deterministicMotionExpressionRandom(args[0], args[1]);
    }
    return Number.isFinite(value)
      ? { ok: true, value }
      : {
          ok: false,
          failures: [failure(
            MOTION_EXPRESSION_ERROR_CODES.NON_FINITE_OUTPUT,
            node.position,
            'Expression operation produced a non-finite value.',
          )],
        };
  };

  return evaluateNode(validated.value.ast);
}

export interface ResolveMotionExpressionValueInput {
  readonly program?: MotionExpressionProgramV1;
  readonly context: MotionExpressionContext;
  readonly keyframedValue?: number;
  readonly baseValue: number;
}

export function resolveMotionExpressionValue(
  input: ResolveMotionExpressionValueInput,
): MotionExpressionResult<MotionExpressionResolvedValue> {
  const inputInspection = inspectExactDataRecord(
    input,
    RESOLVE_INPUT_KEYS,
    RESOLVE_INPUT_REQUIRED_KEYS,
  );
  if (!inputInspection) {
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.FALLBACK_INVALID,
        0,
        'Expression resolution input must be an exact inert envelope.',
      )],
    };
  }
  const context = inspectContext(inputInspection.descriptors.context.value);
  if (!context) {
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.CONTEXT_INVALID,
        0,
        'Expression context requires finite clip-local time, zero-based index, and positive effective count.',
      )],
    };
  }
  const program = inputInspection.descriptors.program?.value;
  const keyframedValue = inputInspection.descriptors.keyframedValue?.value;
  const baseValue = inputInspection.descriptors.baseValue.value;
  if (program !== undefined) {
    const evaluated = evaluateMotionExpression(program, context);
    if (!evaluated.ok) return evaluated;
    return {
      ok: true,
      value: {
        value: evaluated.value,
        source: 'expression',
        precedence: MOTION_EXPRESSION_PRECEDENCE,
      },
    };
  }
  const fallback = keyframedValue ?? baseValue;
  if (!Number.isFinite(fallback)) {
    return {
      ok: false,
      failures: [failure(
        MOTION_EXPRESSION_ERROR_CODES.FALLBACK_INVALID,
        0,
        'Keyframe and base fallback values must be finite.',
      )],
    };
  }
  return {
    ok: true,
    value: {
      value: fallback,
      source: keyframedValue !== undefined ? 'keyframe' : 'base',
      precedence: MOTION_EXPRESSION_PRECEDENCE,
    },
  };
}
