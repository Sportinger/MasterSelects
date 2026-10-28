import { EFFECT_REGISTRY, type EffectParam } from '../../../effects';
import type { JsonObject, JsonValue } from './contracts';
import { classifyAdjustmentEffect } from './adjustmentEffectClassification';
import {
  InvalidAdjustmentEffectParametersError,
  installAdjustmentEffectAdmissionPolicy,
} from './supportedEffects';

/**
 * A value parameter sanitizing could not keep: a value of the wrong type is swapped for the
 * parameter's default. Strict callers (contracts, AI tools) reject it; the render admission keeps
 * rendering with the default and says so. Numbers are never clamped here: the effect itself clamps
 * to its renderMin/renderMax exactly as on a clip, and the inspector and tool results name that
 * (paramRangeNotes), so an adjustment layer renders the same values a clip does.
 */
export interface AdjustmentEffectParameterIssue {
  readonly parameter: string;
  readonly kind: 'replaced';
  readonly message: string;
}

export interface SanitizedAdjustmentEffectParameters {
  readonly parameters: JsonObject;
  readonly issues: readonly AdjustmentEffectParameterIssue[];
}

function isScalar(value: unknown): value is number | boolean | string {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

function expectedType(definition: EffectParam): string {
  switch (definition.type) {
    case 'number': return 'a finite number';
    case 'boolean': return 'true or false';
    case 'select': return 'one of its options';
    default: return 'text';
  }
}

function hasValidType(definition: EffectParam, value: unknown): boolean {
  switch (definition.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    // Option membership stays with the effect (packers accept retired option aliases).
    case 'select': return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
    case 'color':
    case 'text': return typeof value === 'string';
    default: return isScalar(value);
  }
}

/**
 * Checks one effect's parameters against its own registry definitions by type: numbers must be
 * finite (their range stays with the effect, see AdjustmentEffectParameterIssue), booleans, selects,
 * colors and text must have their type. Parameters the definition does not list (exposed graph
 * values, runtime travel values in saved projects) pass when they are plain scalars; new AI input
 * is checked for unknown names separately (unknownAdjustmentEffectParameters).
 */
export function sanitizeAdjustmentEffectParameters(
  effectType: string,
  parameters: Readonly<Record<string, unknown>>,
): SanitizedAdjustmentEffectParameters {
  const definitions = EFFECT_REGISTRY.get(effectType)?.params ?? {};
  const issues: AdjustmentEffectParameterIssue[] = [];
  const result: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(parameters)) {
    const definition = definitions[name];
    if (!definition) {
      if (!isScalar(value) || (typeof value === 'number' && !Number.isFinite(value))) {
        issues.push({ parameter: name, kind: 'replaced', message: `${name} must be a number, true/false or text; it is ignored.` });
        continue;
      }
      result[name] = value;
      continue;
    }
    if (!hasValidType(definition, value)) {
      issues.push({
        parameter: name,
        kind: 'replaced',
        message: `${name} must be ${expectedType(definition)}; it renders with its default ${JSON.stringify(definition.default)}.`,
      });
      result[name] = definition.default;
      continue;
    }
    result[name] = value as JsonValue;
  }
  return { parameters: result, issues };
}

/**
 * Parameter names new input (AI tools) sets that the effect does not define, for the same
 * "Unknown parameter ... Valid: ..." refusal updateEffect gives on clips. Retired parameters stay
 * accepted (saved projects carry them) but are not offered as valid names.
 */
export function unknownAdjustmentEffectParameters(
  effectType: string,
  names: readonly string[],
): { unknown: string[]; valid: string[] } {
  const definitions = EFFECT_REGISTRY.get(effectType)?.params ?? {};
  return {
    unknown: names.filter((name) => !Object.hasOwn(definitions, name)),
    valid: Object.entries(definitions)
      .filter(([, definition]) => !(definition.deprecated && definition.hidden))
      .map(([name]) => name)
      .toSorted(),
  };
}

function normalizeRegistryParameters(effectType: string, parameters: JsonObject): JsonObject {
  const sanitized = sanitizeAdjustmentEffectParameters(effectType, parameters);
  const [invalid] = sanitized.issues;
  if (invalid) throw new InvalidAdjustmentEffectParametersError(effectType, invalid.message);
  return sanitized.parameters;
}

installAdjustmentEffectAdmissionPolicy({
  classify(effectType) {
    const classification = classifyAdjustmentEffect(effectType);
    return classification.admitted ? { admitted: true } : { admitted: false, reason: classification.reason };
  },
  normalizeParameters: normalizeRegistryParameters,
});

/** Importing this module installs the registry admission; callers use this to make that explicit. */
export function ensureAdjustmentEffectRegistryAdmission(): void {
  // The policy is installed when this module loads.
}
