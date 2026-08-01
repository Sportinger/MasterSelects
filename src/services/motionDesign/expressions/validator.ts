import {
  MOTION_EXPRESSION_BUDGETS,
  MOTION_EXPRESSION_ERROR_CODES,
  MOTION_EXPRESSION_VERSION,
  type MotionExpressionAstNode,
  type MotionExpressionFailure,
  type MotionExpressionProgramV1,
  type MotionExpressionResult,
} from './contracts';
import { parseMotionExpressionTokens } from './parser';
import { tokenizeMotionExpression } from './tokenizer';
import { inspectDenseDataArray, inspectExactDataRecord } from './boundarySafety';

const VARIABLES = new Set(['time', 'index', 'count']);
const PROGRAM_KEYS = new Set(['version', 'source', 'ast', 'tokenCount', 'astNodeCount']);
const NUMBER_NODE_KEYS = new Set(['type', 'value', 'position']);
const VARIABLE_NODE_KEYS = new Set(['type', 'name', 'position']);
const UNARY_NODE_KEYS = new Set(['type', 'operator', 'argument', 'position']);
const BINARY_NODE_KEYS = new Set(['type', 'operator', 'left', 'right', 'position']);
const CALL_NODE_KEYS = new Set(['type', 'name', 'arguments', 'position']);

function failure(
  code: MotionExpressionFailure['code'],
  position: number,
  message: string,
): MotionExpressionFailure {
  return { code, position, message };
}

type ProgramEnvelopeInspection =
  | { readonly ok: true; readonly source: string }
  | { readonly ok: false; readonly failure: MotionExpressionFailure };

function invalidProgram(message: string): ProgramEnvelopeInspection {
  return {
    ok: false,
    failure: failure(MOTION_EXPRESSION_ERROR_CODES.PROGRAM_INVALID, 0, message),
  };
}

function inspectProgramEnvelope(program: unknown): ProgramEnvelopeInspection {
  const root = inspectExactDataRecord(program, PROGRAM_KEYS);
  if (!root) return invalidProgram('Expression program must be an exact inert envelope.');
  const version = root.descriptors.version.value;
  const source = root.descriptors.source.value;
  const tokenCount = root.descriptors.tokenCount.value;
  const astNodeCount = root.descriptors.astNodeCount.value;
  if (
    version !== MOTION_EXPRESSION_VERSION ||
    typeof source !== 'string' ||
    !Number.isSafeInteger(tokenCount) ||
    (tokenCount as number) < 0 ||
    (tokenCount as number) > MOTION_EXPRESSION_BUDGETS.maxTokens ||
    !Number.isSafeInteger(astNodeCount) ||
    (astNodeCount as number) <= 0 ||
    (astNodeCount as number) > MOTION_EXPRESSION_BUDGETS.maxAstNodes
  ) {
    return invalidProgram('Expression program metadata is malformed or over budget.');
  }

  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root.descriptors.ast.value, depth: 1 },
  ];
  const seen = new Set<object>();
  let nodeCount = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodeCount += 1;
    if (
      nodeCount > MOTION_EXPRESSION_BUDGETS.maxAstNodes ||
      current.depth > MOTION_EXPRESSION_BUDGETS.maxAstDepth
    ) {
      return {
        ok: false,
        failure: failure(
          MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED,
          0,
          'Persisted expression AST exceeds its hard node or depth budget.',
        ),
      };
    }
    if (current.value === null || typeof current.value !== 'object') {
      return invalidProgram('Expression AST nodes must be exact inert objects.');
    }
    if (seen.has(current.value)) return invalidProgram('Expression AST cannot contain shared cycles.');
    seen.add(current.value);

    const typeDescriptor = Object.getOwnPropertyDescriptor(current.value, 'type');
    if (!typeDescriptor || !typeDescriptor.enumerable || !('value' in typeDescriptor)) {
      return invalidProgram('Expression AST nodes require an inert type discriminator.');
    }
    const type = typeDescriptor.value;
    const allowedKeys = type === 'number'
      ? NUMBER_NODE_KEYS
      : type === 'variable'
        ? VARIABLE_NODE_KEYS
        : type === 'unary'
          ? UNARY_NODE_KEYS
          : type === 'binary'
            ? BINARY_NODE_KEYS
            : type === 'call'
              ? CALL_NODE_KEYS
              : undefined;
    if (!allowedKeys) return invalidProgram('Expression AST node type is unsupported.');
    const node = inspectExactDataRecord(current.value, allowedKeys);
    if (!node) return invalidProgram('Expression AST nodes must use exact inert fields.');
    const position = node.descriptors.position.value;
    if (!Number.isSafeInteger(position) || (position as number) < 0) {
      return invalidProgram('Expression AST positions must be non-negative safe integers.');
    }

    if (type === 'number') {
      if (typeof node.descriptors.value.value !== 'number' || !Number.isFinite(node.descriptors.value.value)) {
        return invalidProgram('Expression number nodes require a finite value.');
      }
    } else if (type === 'variable') {
      if (typeof node.descriptors.name.value !== 'string') {
        return invalidProgram('Expression variable nodes require a string name.');
      }
    } else if (type === 'unary') {
      if (node.descriptors.operator.value !== '+' && node.descriptors.operator.value !== '-') {
        return invalidProgram('Expression unary nodes use an unsupported operator.');
      }
      stack.push({ value: node.descriptors.argument.value, depth: current.depth + 1 });
    } else if (type === 'binary') {
      const operator = node.descriptors.operator.value;
      if (operator !== '+' && operator !== '-' && operator !== '*' && operator !== '/' && operator !== '%') {
        return invalidProgram('Expression binary nodes use an unsupported operator.');
      }
      stack.push({ value: node.descriptors.right.value, depth: current.depth + 1 });
      stack.push({ value: node.descriptors.left.value, depth: current.depth + 1 });
    } else {
      if (typeof node.descriptors.name.value !== 'string') {
        return invalidProgram('Expression call nodes require a string name.');
      }
      const args = inspectDenseDataArray(
        node.descriptors.arguments.value,
        MOTION_EXPRESSION_BUDGETS.maxAstNodes,
      );
      if (!args.ok) return invalidProgram('Expression call arguments must be a dense inert array.');
      for (let index = args.values.length - 1; index >= 0; index -= 1) {
        stack.push({ value: args.values[index], depth: current.depth + 1 });
      }
    }
  }
  return { ok: true, source };
}

function validateAst(ast: MotionExpressionAstNode): readonly MotionExpressionFailure[] {
  const failures: MotionExpressionFailure[] = [];
  const stack: { node: MotionExpressionAstNode; depth: number }[] = [{ node: ast, depth: 1 }];
  let nodeCount = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodeCount += 1;
    if (
      nodeCount > MOTION_EXPRESSION_BUDGETS.maxAstNodes ||
      current.depth > MOTION_EXPRESSION_BUDGETS.maxAstDepth
    ) {
      failures.push(failure(
        MOTION_EXPRESSION_ERROR_CODES.AST_BUDGET_EXCEEDED,
        current.node.position,
        'Expression exceeds the AST budget.',
      ));
      break;
    }
    const node = current.node;
    if (node.type === 'variable') {
      if (!VARIABLES.has(node.name)) {
        failures.push(failure(
          MOTION_EXPRESSION_ERROR_CODES.IDENTIFIER_FORBIDDEN,
          node.position,
          `Identifier ${JSON.stringify(node.name)} is not allowed.`,
        ));
      }
      continue;
    }
    if (node.type === 'unary') {
      stack.push({ node: node.argument, depth: current.depth + 1 });
      continue;
    }
    if (node.type === 'binary') {
      stack.push({ node: node.right, depth: current.depth + 1 });
      stack.push({ node: node.left, depth: current.depth + 1 });
      continue;
    }
    if (node.type === 'call') {
      if (node.name !== 'sin' && node.name !== 'cos' && node.name !== 'random') {
        failures.push(failure(
          MOTION_EXPRESSION_ERROR_CODES.CALL_FORBIDDEN,
          node.position,
          `Function ${JSON.stringify(node.name)} is not allowed.`,
        ));
      } else if (
        ((node.name === 'sin' || node.name === 'cos') && node.arguments.length !== 1) ||
        (node.name === 'random' && node.arguments.length !== 2)
      ) {
        failures.push(failure(
          MOTION_EXPRESSION_ERROR_CODES.CALL_SIGNATURE_INVALID,
          node.position,
          'Function call has an invalid argument count.',
        ));
      } else if (node.name === 'random') {
        const seed = node.arguments[0];
        const salt = node.arguments[1];
        if (
          seed?.type !== 'number' ||
          !Number.isSafeInteger(seed.value) ||
          seed.value < 0 ||
          seed.value > 0xffffffff ||
          salt?.type !== 'variable' ||
          salt.name !== 'index'
        ) {
          failures.push(failure(
            MOTION_EXPRESSION_ERROR_CODES.CALL_SIGNATURE_INVALID,
            node.position,
            'random requires an explicit uint32 literal seed and the zero-based index: random(seed, index).',
          ));
        }
      }
      for (let index = node.arguments.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.arguments[index], depth: current.depth + 1 });
      }
    }
  }
  return failures;
}

export function compileMotionExpression(source: string): MotionExpressionResult<MotionExpressionProgramV1> {
  const tokenized = tokenizeMotionExpression(source);
  if (!tokenized.ok) return tokenized;
  const parsed = parseMotionExpressionTokens(tokenized.value);
  if (!parsed.ok) return parsed;
  const validationFailures = validateAst(parsed.value.ast);
  if (validationFailures.length > 0) return { ok: false, failures: validationFailures };
  return {
    ok: true,
    value: {
      version: MOTION_EXPRESSION_VERSION,
      source,
      ast: parsed.value.ast,
      tokenCount: tokenized.value.length - 1,
      astNodeCount: parsed.value.astNodeCount,
    },
  };
}

/** Source is authoritative; persisted/tampered AST data is never executed. */
export function validateMotionExpressionProgram(
  program: unknown,
): MotionExpressionResult<MotionExpressionProgramV1> {
  const inspection = inspectProgramEnvelope(program);
  if (!inspection.ok) return { ok: false, failures: [inspection.failure] };
  return compileMotionExpression(inspection.source);
}
