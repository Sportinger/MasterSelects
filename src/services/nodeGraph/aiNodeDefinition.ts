import type {
  ClipCustomNodeParamDefinition,
  ClipCustomNodeParamOption,
  ClipCustomNodeParamType,
  ClipCustomNodeParamValue,
} from '../../types';
import { normalizeHexColor } from '../../utils/colorParam';
import { Logger } from '../logger';

const log = Logger.create('AINodeDefinition');

interface AINodeDefinitionPayload {
  params?: unknown;
}

export function stripAINodeCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = /^```(?:ts|tsx|typescript|js|javascript)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenceMatch?.[1] ?? trimmed).trim();
}

function isAINodeCode(value: string): boolean {
  return /defineNode\s*\(/.test(value);
}

export function extractAINodeGeneratedCode(value: string): string | null {
  const activationMatch = /<activate[_-](?:node[_-])?code>\s*([\s\S]*?)\s*<\/activate[_-](?:node[_-])?code>/i.exec(value);
  if (activationMatch) {
    const activatedCode = stripAINodeCodeFence(activationMatch[1]);
    return isAINodeCode(activatedCode) ? activatedCode : null;
  }

  const fencedBlock = /```(?:ts|tsx|typescript|js|javascript)?\s*([\s\S]*?defineNode\s*\([\s\S]*?)```/i.exec(value);
  if (fencedBlock) {
    const fencedCode = stripAINodeCodeFence(fencedBlock[1]);
    return isAINodeCode(fencedCode) ? fencedCode : null;
  }

  const candidate = stripAINodeCodeFence(value);
  return /^\s*defineNode\s*\(/.test(candidate) ? candidate : null;
}

function isParamValue(value: unknown): value is ClipCustomNodeParamValue {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function inferParamType(value: ClipCustomNodeParamValue): ClipCustomNodeParamType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function sanitizeParamId(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  const sanitized = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^([^A-Za-z_])/, '_$1');
  return sanitized || fallback;
}

function normalizeParamType(value: unknown, fallback: ClipCustomNodeParamType): ClipCustomNodeParamType {
  return value === 'number' || value === 'boolean' || value === 'string' || value === 'select' || value === 'color'
    ? value
    : fallback;
}

function normalizeOptions(value: unknown): ClipCustomNodeParamOption[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const options = value
    .map((option): ClipCustomNodeParamOption | null => {
      if (isParamValue(option)) {
        return { label: String(option), value: option };
      }

      const record = option as { label?: unknown; value?: unknown };
      if (!isParamValue(record.value)) {
        return null;
      }

      return {
        label: typeof record.label === 'string' && record.label.trim()
          ? record.label.trim()
          : String(record.value),
        value: record.value,
      };
    })
    .filter((option): option is ClipCustomNodeParamOption => option !== null);

  return options.length > 0 ? options : undefined;
}

function normalizeParamDefinition(
  source: unknown,
  fallbackId: string,
): ClipCustomNodeParamDefinition | null {
  if (isParamValue(source)) {
    return {
      id: sanitizeParamId(fallbackId, fallbackId),
      label: fallbackId,
      type: inferParamType(source),
      default: source,
    };
  }

  if (!source || typeof source !== 'object') {
    return null;
  }

  const record = source as {
    id?: unknown;
    name?: unknown;
    label?: unknown;
    type?: unknown;
    default?: unknown;
    defaultValue?: unknown;
    value?: unknown;
    min?: unknown;
    max?: unknown;
    step?: unknown;
    options?: unknown;
  };
  const id = sanitizeParamId(record.id ?? record.name, fallbackId);
  const explicitDefault = record.default ?? record.defaultValue ?? record.value;
  const fallbackDefault = isParamValue(explicitDefault) ? explicitDefault : 0;
  const fallbackType = isParamValue(fallbackDefault) ? inferParamType(fallbackDefault) : 'number';
  const type = normalizeParamType(record.type, fallbackType);
  const defaultValue = type === 'color'
    ? normalizeHexColor(explicitDefault)
    : fallbackDefault;
  const options = normalizeOptions(record.options);
  const normalizedDefault = type === 'number'
    ? Number(defaultValue) || 0
    : type === 'boolean'
      ? Boolean(defaultValue)
      : defaultValue;

  return {
    id,
    label: typeof record.label === 'string' && record.label.trim() ? record.label.trim() : id,
    type,
    default: normalizedDefault,
    ...(typeof record.min === 'number' ? { min: record.min } : {}),
    ...(typeof record.max === 'number' ? { max: record.max } : {}),
    ...(typeof record.step === 'number' ? { step: record.step } : {}),
    ...(options ? { options } : {}),
  };
}

function normalizeParams(params: unknown): ClipCustomNodeParamDefinition[] {
  const seen = new Set<string>();
  const definitions = Array.isArray(params)
    ? params.map((param, index) => normalizeParamDefinition(param, `param_${index + 1}`))
    : params && typeof params === 'object'
      ? Object.entries(params as Record<string, unknown>)
          .map(([id, param]) => normalizeParamDefinition(param, id))
      : [];

  return definitions.filter((definition): definition is ClipCustomNodeParamDefinition => {
    if (!definition || seen.has(definition.id)) {
      return false;
    }
    seen.add(definition.id);
    return true;
  });
}

function compileNodeDefinition(code: string): AINodeDefinitionPayload | null {
  let captured: AINodeDefinitionPayload | null = null;
  const defineNode = (definition: AINodeDefinitionPayload) => {
    captured = definition;
    return definition;
  };

  try {
    const run = new Function('defineNode', `"use strict";\n${code}\n;`);
    run(defineNode);
  } catch (error) {
    log.warn('Failed to inspect generated AI node definition', error);
  }

  return captured;
}

export function extractAINodeParameterSchemaFromCode(code: string): ClipCustomNodeParamDefinition[] {
  const definition = compileNodeDefinition(code.trim());
  return normalizeParams(definition?.params);
}

export function mergeAINodeParamDefaults(
  schema: ClipCustomNodeParamDefinition[],
  existingParams?: Record<string, ClipCustomNodeParamValue>,
): Record<string, ClipCustomNodeParamValue> {
  const nextParams: Record<string, ClipCustomNodeParamValue> = {};

  for (const param of schema) {
    const existingValue = existingParams?.[param.id];
    const value = isParamValue(existingValue) ? existingValue : param.default;
    nextParams[param.id] = param.type === 'color'
      ? normalizeHexColor(value, String(param.default))
      : value;
  }

  return nextParams;
}
