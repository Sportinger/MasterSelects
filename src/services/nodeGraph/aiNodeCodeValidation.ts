import { parse } from 'acorn';

const AI_NODE_MAX_CODE_LENGTH = 64 * 1024;
const AI_NODE_MAX_AST_NODES = 12_000;

const BLOCKED_NODE_TYPES = new Set([
  'AwaitExpression',
  'ClassDeclaration',
  'ClassExpression',
  'DebuggerStatement',
  'ImportExpression',
  'MetaProperty',
  'Super',
  'ThisExpression',
  'WithStatement',
  'YieldExpression',
]);

const BLOCKED_IDENTIFIERS = new Set([
  'AsyncFunction',
  'Atomics',
  'BroadcastChannel',
  'Date',
  'EventSource',
  'Function',
  'GeneratorFunction',
  'MessageChannel',
  'MessagePort',
  'OffscreenCanvas',
  'Promise',
  'SharedArrayBuffer',
  'SharedWorker',
  'WebAssembly',
  'WebSocket',
  'WebTransport',
  'Worker',
  'WorkerGlobalScope',
  'XMLHttpRequest',
  'caches',
  'close',
  'createImageBitmap',
  'crypto',
  'document',
  'eval',
  'fetch',
  'globalThis',
  'importScripts',
  'indexedDB',
  'localStorage',
  'location',
  'navigator',
  'performance',
  'postMessage',
  'queueMicrotask',
  'self',
  'sessionStorage',
  'setInterval',
  'setTimeout',
  'window',
]);

const BLOCKED_PROPERTIES = new Set([
  '__proto__',
  'arguments',
  'callee',
  'caller',
  'constructor',
  'prototype',
]);

const STATIC_DEFINITION_KEYS = new Set(['name', 'inputs', 'outputs', 'params']);
const INVALID_STATIC_VALUE = Symbol('invalid-ai-node-static-value');

interface AstNode {
  type: string;
  [key: string]: unknown;
}

export interface AINodeCodeValidationResult {
  valid: boolean;
  error?: string;
}

const validationCache = new Map<string, AINodeCodeValidationResult>();

function isAstNode(value: unknown): value is AstNode {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

function getPropertyName(property: AstNode): string | null {
  const key = property.key;
  if (!isAstNode(key)) return null;
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return null;
}

function readStaticValue(node: unknown): unknown | typeof INVALID_STATIC_VALUE {
  if (!isAstNode(node)) return INVALID_STATIC_VALUE;

  if (node.type === 'Literal') {
    const value = node.value;
    return value === null || ['string', 'number', 'boolean'].includes(typeof value)
      ? value
      : INVALID_STATIC_VALUE;
  }

  if (node.type === 'TemplateLiteral') {
    const expressions = Array.isArray(node.expressions) ? node.expressions : [];
    const quasis = Array.isArray(node.quasis) ? node.quasis : [];
    if (expressions.length > 0 || quasis.length !== 1 || !isAstNode(quasis[0])) {
      return INVALID_STATIC_VALUE;
    }
    const cooked = (quasis[0].value as { cooked?: unknown } | undefined)?.cooked;
    return typeof cooked === 'string' ? cooked : INVALID_STATIC_VALUE;
  }

  if (node.type === 'UnaryExpression' && typeof node.operator === 'string') {
    const argument = readStaticValue(node.argument);
    if (argument === INVALID_STATIC_VALUE) return INVALID_STATIC_VALUE;
    if (node.operator === '-' && typeof argument === 'number') return -argument;
    if (node.operator === '+' && typeof argument === 'number') return argument;
    if (node.operator === '!' && typeof argument === 'boolean') return !argument;
    return INVALID_STATIC_VALUE;
  }

  if (node.type === 'ArrayExpression') {
    const elements = Array.isArray(node.elements) ? node.elements : [];
    const values: unknown[] = [];
    for (const element of elements) {
      const value = readStaticValue(element);
      if (value === INVALID_STATIC_VALUE) return INVALID_STATIC_VALUE;
      values.push(value);
    }
    return values;
  }

  if (node.type === 'ObjectExpression') {
    const properties = Array.isArray(node.properties) ? node.properties : [];
    const value: Record<string, unknown> = {};
    for (const property of properties) {
      if (!isAstNode(property) || property.type !== 'Property' || property.computed || property.kind !== 'init') {
        return INVALID_STATIC_VALUE;
      }
      const name = getPropertyName(property);
      const propertyValue = readStaticValue(property.value);
      if (!name || BLOCKED_PROPERTIES.has(name) || propertyValue === INVALID_STATIC_VALUE) {
        return INVALID_STATIC_VALUE;
      }
      value[name] = propertyValue;
    }
    return value;
  }

  return INVALID_STATIC_VALUE;
}

function getDefineNodeObject(program: AstNode): AstNode | null {
  const body = Array.isArray(program.body) ? program.body : [];
  if (program.type !== 'Program' || body.length !== 1 || !isAstNode(body[0]) || body[0].type !== 'ExpressionStatement') {
    return null;
  }

  const expression = body[0].expression;
  if (!isAstNode(expression) || expression.type !== 'CallExpression' || expression.optional) return null;
  const callee = expression.callee;
  const args = Array.isArray(expression.arguments) ? expression.arguments : [];
  if (!isAstNode(callee) || callee.type !== 'Identifier' || callee.name !== 'defineNode' || args.length !== 1) {
    return null;
  }

  return isAstNode(args[0]) && args[0].type === 'ObjectExpression' ? args[0] : null;
}

function validateDefinitionObject(definition: AstNode): string | null {
  const properties = Array.isArray(definition.properties) ? definition.properties : [];
  let processFound = false;

  for (const property of properties) {
    if (!isAstNode(property) || property.type !== 'Property' || property.computed || property.kind !== 'init') {
      return 'The defineNode object may only contain ordinary, non-computed properties.';
    }
    const name = getPropertyName(property);
    if (!name || BLOCKED_PROPERTIES.has(name)) return 'A blocked property name was used.';

    if (name === 'process') {
      const value = property.value;
      if (!isAstNode(value) || !['FunctionExpression', 'ArrowFunctionExpression'].includes(value.type)) {
        return 'defineNode.process must be a function.';
      }
      if (value.async || value.generator) return 'Async and generator process functions are not allowed.';
      processFound = true;
      continue;
    }

    if (!STATIC_DEFINITION_KEYS.has(name)) return `Unsupported defineNode property: ${name}.`;
    if (readStaticValue(property.value) === INVALID_STATIC_VALUE) {
      return `defineNode.${name} must contain static JSON-like data.`;
    }
  }

  return processFound ? null : 'defineNode.process is required.';
}

function validateAst(root: AstNode): string | null {
  let visited = 0;
  const stack: AstNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    visited += 1;
    if (visited > AI_NODE_MAX_AST_NODES) return 'The generated node is too complex.';
    if (BLOCKED_NODE_TYPES.has(node.type)) return `${node.type} is not allowed in generated nodes.`;
    if (node.type === 'Identifier' && typeof node.name === 'string' && BLOCKED_IDENTIFIERS.has(node.name)) {
      return `${node.name} is not available to generated nodes.`;
    }
    if (node.type === 'MemberExpression') {
      const property = node.property;
      const propertyName = isAstNode(property)
        ? property.type === 'Identifier' && !node.computed
          ? property.name
          : property.type === 'Literal'
            ? property.value
            : undefined
        : undefined;
      if (typeof propertyName === 'string' && BLOCKED_PROPERTIES.has(propertyName)) {
        return `Property ${propertyName} is not allowed in generated nodes.`;
      }
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) && (node.async || node.generator)) {
      return 'Async and generator functions are not allowed.';
    }

    for (const value of Object.values(node)) {
      if (isAstNode(value)) {
        stack.push(value);
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (isAstNode(entry)) stack.push(entry);
        }
      }
    }
  }

  return null;
}

function parseAINodeProgram(code: string): AstNode | null {
  try {
    return parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
    }) as unknown as AstNode;
  } catch {
    return null;
  }
}

export function validateAINodeGeneratedCode(code: string): AINodeCodeValidationResult {
  const cached = validationCache.get(code);
  if (cached) return cached;

  let result: AINodeCodeValidationResult;
  if (!code.trim()) {
    result = { valid: false, error: 'Generated node code is empty.' };
  } else if (code.length > AI_NODE_MAX_CODE_LENGTH) {
    result = { valid: false, error: 'Generated node code exceeds the 64 KiB limit.' };
  } else {
    const program = parseAINodeProgram(code);
    const definition = program ? getDefineNodeObject(program) : null;
    const error = !program
      ? 'Generated node code is not valid JavaScript.'
      : !definition
        ? 'Code must contain exactly one defineNode({...}) call.'
        : validateDefinitionObject(definition) ?? validateAst(program);
    result = error ? { valid: false, error } : { valid: true };
  }

  validationCache.set(code, result);
  return result;
}

export function extractAINodeStaticDefinition(code: string): Record<string, unknown> | null {
  if (!validateAINodeGeneratedCode(code).valid) return null;
  const program = parseAINodeProgram(code);
  const definition = program ? getDefineNodeObject(program) : null;
  if (!definition) return null;

  const result: Record<string, unknown> = {};
  const properties = Array.isArray(definition.properties) ? definition.properties : [];
  for (const property of properties) {
    if (!isAstNode(property) || property.type !== 'Property') continue;
    const name = getPropertyName(property);
    if (!name || name === 'process') continue;
    const value = readStaticValue(property.value);
    if (value !== INVALID_STATIC_VALUE) result[name] = value;
  }
  return result;
}
