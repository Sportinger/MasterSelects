import { describe, expect, it } from 'vitest';
import {
  MOTION_EXPRESSION_BUDGETS,
  MOTION_EXPRESSION_ERROR_CODES,
  MOTION_EXPRESSION_PRECEDENCE,
  type MotionExpressionProgramV1,
} from '../../src/services/motionDesign/expressions/contracts';
import {
  deterministicMotionExpressionRandom,
  evaluateMotionExpression,
  resolveMotionExpressionValue,
} from '../../src/services/motionDesign/expressions/evaluator';
import { parseMotionExpressionTokens } from '../../src/services/motionDesign/expressions/parser';
import {
  compileMotionExpression,
  validateMotionExpressionProgram,
} from '../../src/services/motionDesign/expressions/validator';

function createAdversarialArray<T>(
  values: readonly T[],
  counter: { calls: number },
): readonly T[] {
  class AdversarialArray extends Array<T> {}
  const fail = (): never => {
    counter.calls += 1;
    throw new Error('Adversarial array method must not execute.');
  };
  Object.defineProperties(AdversarialArray.prototype, {
    [Symbol.iterator]: { configurable: true, value: fail },
    map: { configurable: true, value: fail },
    find: { configurable: true, value: fail },
    forEach: { configurable: true, value: fail },
  });
  const array = new AdversarialArray<T>();
  for (let index = 0; index < values.length; index += 1) {
    Array.prototype.push.call(array, values[index]);
  }
  return array;
}

function compile(source: string): MotionExpressionProgramV1 {
  const result = compileMotionExpression(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.failures[0]?.message);
  return result.value;
}

function balancedSum(depth: number): string {
  return depth === 0 ? '1' : `(${balancedSum(depth - 1)}+${balancedSum(depth - 1)})`;
}

describe('MD8 tiny Motion expression contract freeze', () => {
  it('uses clip-local time, zero-based index, and effective count', () => {
    const program = compile('time * 10 + index / count + sin(time) - cos(time)');
    const result = evaluateMotionExpression(program, { time: 2, index: 0, count: 8 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(20 + Math.sin(2) - Math.cos(2), 12);
    }

    const nextIndex = evaluateMotionExpression(program, { time: 2, index: 1, count: 8 });
    expect(nextIndex.ok).toBe(true);
    if (result.ok && nextIndex.ok) expect(nextIndex.value - result.value).toBeCloseTo(1 / 8, 12);
  });

  it('freezes seeded random as deterministic uint32 seed plus zero-based index', () => {
    const program = compile('random(42, index)');
    const first = evaluateMotionExpression(program, { time: 0, index: 3, count: 10 });
    const again = evaluateMotionExpression(program, { time: 999, index: 3, count: 10 });
    const otherIndex = evaluateMotionExpression(program, { time: 0, index: 4, count: 10 });
    const otherSeed = evaluateMotionExpression(compile('random(43, index)'), {
      time: 0, index: 3, count: 10,
    });
    expect(first).toEqual(again);
    expect(first.ok && first.value).toBe(deterministicMotionExpressionRandom(42, 3));
    expect(otherIndex).not.toEqual(first);
    expect(otherSeed).not.toEqual(first);
  });

  it('round-trips compiled programs as runtime-handle-free JSON', () => {
    const program = compile('sin(time) * 20 + random(7, index)');
    const roundTrip = JSON.parse(JSON.stringify(program)) as MotionExpressionProgramV1;
    expect(roundTrip).toEqual(program);
    expect(evaluateMotionExpression(roundTrip, { time: 1, index: 2, count: 5 }))
      .toEqual(evaluateMotionExpression(program, { time: 1, index: 2, count: 5 }));
  });

  it('gives expressions precedence over keyframes and never falls back after expression failure', () => {
    const expression = resolveMotionExpressionValue({
      program: compile('time * 2'),
      context: { time: 3, index: 0, count: 1 },
      keyframedValue: 999,
      baseValue: 5,
    });
    const keyframe = resolveMotionExpressionValue({
      context: { time: 3, index: 0, count: 1 },
      keyframedValue: 12,
      baseValue: 5,
    });
    const base = resolveMotionExpressionValue({
      context: { time: 3, index: 0, count: 1 },
      baseValue: 5,
    });
    expect(expression).toEqual({
      ok: true,
      value: { value: 6, source: 'expression', precedence: MOTION_EXPRESSION_PRECEDENCE },
    });
    expect(keyframe).toEqual({
      ok: true,
      value: { value: 12, source: 'keyframe', precedence: MOTION_EXPRESSION_PRECEDENCE },
    });
    expect(base).toEqual({
      ok: true,
      value: { value: 5, source: 'base', precedence: MOTION_EXPRESSION_PRECEDENCE },
    });

    const failed = resolveMotionExpressionValue({
      program: compile('1 / 0'),
      context: { time: 0, index: 0, count: 1 },
      keyframedValue: 123,
      baseValue: 5,
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.NON_FINITE_OUTPUT);
  });

  it.each([
    'globalThis',
    'eval(1)',
    'Function(1)',
    'Math.sin(time)',
    'time.constructor',
    'sin.constructor(time)',
    'random(time, index)',
    'random(1, count)',
    'random(1)',
    'random(1, index, count)',
    'while(time)',
    '1;2',
    'index[0]',
    '"time"',
  ])('rejects the security payload %s', (source) => {
    expect(compileMotionExpression(source).ok).toBe(false);
  });

  it('enforces named source, token, AST-depth, and evaluation-step budgets', () => {
    const sourceBudget = compileMotionExpression('1'.repeat(MOTION_EXPRESSION_BUDGETS.maxSourceLength + 1));
    const tokenBudget = compileMotionExpression(Array.from({ length: 80 }, () => '1').join('+'));
    const astNodeBudget = compileMotionExpression(Array.from({ length: 40 }, () => '1').join('+'));
    const depthBudget = compileMotionExpression(`${'-'.repeat(MOTION_EXPRESSION_BUDGETS.maxAstDepth + 1)}1`);
    expect(sourceBudget.ok).toBe(false);
    expect(tokenBudget.ok).toBe(false);
    expect(astNodeBudget.ok).toBe(false);
    expect(depthBudget.ok).toBe(false);
    if (!sourceBudget.ok && !tokenBudget.ok && !astNodeBudget.ok && !depthBudget.ok) {
      expect(sourceBudget.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.SOURCE_BUDGET_EXCEEDED);
      expect(tokenBudget.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.TOKEN_BUDGET_EXCEEDED);
      expect(astNodeBudget.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED);
      expect(depthBudget.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED);
    }

    const evaluationBudgetProgram = compile(balancedSum(5));
    const evaluationBudget = evaluateMotionExpression(evaluationBudgetProgram, {
      time: 0, index: 0, count: 1,
    });
    expect(evaluationBudget.ok).toBe(false);
    if (!evaluationBudget.ok) {
      expect(evaluationBudget.failures[0]?.code)
        .toBe(MOTION_EXPRESSION_ERROR_CODES.EVALUATION_BUDGET_EXCEEDED);
    }
  });

  it.each(['1 / 0', '0 / 0', '1e308 * 1e308', '1 % 0']) (
    'fails closed for non-finite output from %s',
    (source) => {
      const result = evaluateMotionExpression(compile(source), { time: 0, index: 0, count: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.NON_FINITE_OUTPUT);
      }
    },
  );

  it('rejects invalid index/count context and ignores tampered persisted AST in favor of source', () => {
    const program = compile('index / count');
    const invalidContexts = [
      { time: 0, index: -1, count: 2 },
      { time: 0, index: 2, count: 2 },
      { time: 0, index: 0, count: 0 },
      { time: Number.NaN, index: 0, count: 1 },
      { time: 0, index: 0, count: 0x1_0000_0001 },
    ];
    for (const context of invalidContexts) {
      const result = evaluateMotionExpression(program, context);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.CONTEXT_INVALID);
    }

    const tampered = {
      ...compile('1'),
      ast: {
        type: 'call',
        name: 'eval',
        arguments: [],
        position: 0,
      },
    } as unknown as MotionExpressionProgramV1;
    expect(evaluateMotionExpression(tampered, { time: 0, index: 0, count: 1 }))
      .toEqual({ ok: true, value: 1 });
  });

  it('validates the complete program envelope without invoking root or nested getters', () => {
    const program = compile('sin(time)');
    let getterCalls = 0;
    const sourceAccessor = { ...program } as Record<string, unknown>;
    Object.defineProperty(sourceAccessor, 'source', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'sin(time)';
      },
    });
    const numberNode: Record<string, unknown> = { type: 'number', position: 0 };
    Object.defineProperty(numberNode, 'value', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 1;
      },
    });
    const nestedAccessor = { ...compile('1'), ast: numberNode };

    for (const candidate of [sourceAccessor, nestedAccessor]) {
      const result = validateMotionExpressionProgram(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.PROGRAM_INVALID);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it('rejects unknown/runtime fields, symbols, and sparse AST argument arrays', () => {
    const program = compile('sin(1)');
    const symbolProgram: Record<PropertyKey, unknown> = { ...program };
    symbolProgram[Symbol('runtime')] = true;
    const sparseArguments = new Array(1);
    const sparseProgram = {
      ...program,
      ast: { type: 'call', name: 'sin', arguments: sparseArguments, position: 0 },
    };
    const candidates = [
      { ...program, runtimeHandle: {} },
      { ...program, ast: { ...program.ast, runtimeHandle: {} } },
      symbolProgram,
      sparseProgram,
    ];

    for (const candidate of candidates) {
      const result = validateMotionExpressionProgram(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures[0]?.code).toBe(MOTION_EXPRESSION_ERROR_CODES.PROGRAM_INVALID);
      }
    }
  });

  it('preflights token, context, and resolver envelopes without executing accessors', () => {
    let getterCalls = 0;
    const token: Record<string, unknown> = { lexeme: '1', position: 0, numericValue: 1 };
    Object.defineProperty(token, 'type', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 'number';
      },
    });
    const tokenResult = parseMotionExpressionTokens([
      token,
      { type: 'eof', lexeme: '', position: 1 },
    ]);

    const context: Record<string, unknown> = { index: 0, count: 1 };
    Object.defineProperty(context, 'time', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return 0;
      },
    });
    const evaluation = evaluateMotionExpression(
      compile('1'),
      context,
    );

    const resolverInput: Record<string, unknown> = {
      context: { time: 0, index: 0, count: 1 },
      baseValue: 1,
    };
    Object.defineProperty(resolverInput, 'program', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return compile('1');
      },
    });
    const resolved = resolveMotionExpressionValue(
      resolverInput as unknown as Parameters<typeof resolveMotionExpressionValue>[0],
    );

    expect(tokenResult.ok).toBe(false);
    expect(evaluation.ok).toBe(false);
    expect(resolved.ok).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it('rejects token and AST argument array subclasses before any array method executes', () => {
    const counter = { calls: 0 };
    const tokens = createAdversarialArray([
      { type: 'number', lexeme: '1', position: 0, numericValue: 1 },
      { type: 'eof', lexeme: '', position: 1 },
    ], counter);
    expect(parseMotionExpressionTokens(tokens).ok).toBe(false);

    const program = compile('sin(1)');
    const argumentsSubclass = createAdversarialArray([
      { type: 'number', value: 1, position: 4 },
    ], counter);
    const persisted = {
      ...program,
      ast: {
        type: 'call',
        name: 'sin',
        arguments: argumentsSubclass,
        position: 0,
      },
    };
    expect(validateMotionExpressionProgram(persisted).ok).toBe(false);
    expect(counter.calls).toBe(0);
  });
});
