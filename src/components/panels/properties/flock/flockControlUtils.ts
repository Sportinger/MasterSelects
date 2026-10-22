import type { FlockDefinition, FlockNode } from '../../../../types/flock';
import {
  FLOCK_GROUP_OPERATOR_ID,
  FLOCK_OUTPUT_OPERATOR_ID,
  getFlockOperator,
} from '../../../../services/flock/operators/flockOperatorRegistry';
import type { FlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorTypes';
import { getFlockPreset } from '../../../../services/flock/presets/flockPresets';

export interface FlockParamEntry {
  /** Param id, or `${innerNodeId}__${paramId}` on group instances. */
  key: string;
  descriptor: FlockParamDescriptor;
  innerLabel?: string;
}

export function getFlockNodeLabel(definition: FlockDefinition, nodeId: string): string {
  const node = definition.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return nodeId;
  if (node.label) return node.label;
  if (node.operator === FLOCK_GROUP_OPERATOR_ID) {
    return definition.groups.find((group) => group.id === node.groupRef)?.label ?? 'Group';
  }
  return getFlockOperator(node.operator)?.label ?? node.operator;
}

export function listFlockNodeParams(definition: FlockDefinition, node: FlockNode): FlockParamEntry[] {
  if (node.operator === FLOCK_OUTPUT_OPERATOR_ID) return [];
  if (node.operator !== FLOCK_GROUP_OPERATOR_ID) {
    return (getFlockOperator(node.operator)?.params ?? []).map((descriptor) => ({ key: descriptor.id, descriptor }));
  }
  const group = definition.groups.find((candidate) => candidate.id === node.groupRef);
  return (group?.nodes ?? []).flatMap((inner) => (
    (getFlockOperator(inner.operator)?.params ?? []).map((descriptor) => ({
      key: `${inner.id}__${descriptor.id}`,
      descriptor,
      innerLabel: inner.label ?? getFlockOperator(inner.operator)?.label ?? inner.operator,
    }))
  ));
}

/** Non-animatable or discrete values change structure / resimulate and are never keyframed. */
export function isStructuralFlockParam(descriptor: FlockParamDescriptor): boolean {
  return !descriptor.animatable
    || descriptor.type === 'integer'
    || descriptor.type === 'enum'
    || descriptor.type === 'boolean'
    || descriptor.type === 'asset';
}

export function getFlockInvalidationHint(descriptor: FlockParamDescriptor): string {
  switch (descriptor.invalidation) {
    case 'topology':
      return 'A change restarts the swarm from the clip start';
    case 'behavior':
      return 'A change lets the swarm react from that moment on';
    case 'derived':
      return 'A change redraws the lines';
    default:
      return 'A change only redraws';
  }
}

export function getFlockNumberDecimals(step?: number): number {
  if (step === undefined) return 2;
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

/**
 * Decimals of a promoted number: from its declared step, else from its slider step (Speed 45 and
 * Turbulence 18 read as whole numbers), keeping one decimal for a value that has one (Size 4.2).
 */
export function flockNumberDecimals(descriptor: FlockParamDescriptor, sliderStep: number, value: number): number {
  if (descriptor.step !== undefined) return getFlockNumberDecimals(descriptor.step);
  if (sliderStep >= 1) return Number.isInteger(Math.round(value * 1e6) / 1e6) ? 0 : 1;
  return getFlockNumberDecimals(sliderStep);
}

const presetSignatures = new Map<string, ReadonlySet<string>>();
const controlSignature = (definition: FlockDefinition, exposed: { nodeId: string; param: string }) =>
  `${definition.nodes.find((node) => node.id === exposed.nodeId)?.operator ?? '?'}:${exposed.param}`;
/**
 * Whether a control is one the swarm's preset shows by itself (Population, Cohesion, …), not one
 * added later through Add or the Nodes tab. Preset node ids are generated, so controls compare by
 * node operator and parameter.
 */
export function isPresetFlockControl(definition: FlockDefinition, exposed: { nodeId: string; param: string }): boolean {
  const presetId = definition.presetId;
  const preset = presetId ? getFlockPreset(presetId) : undefined;
  if (!presetId || !preset) return false;
  let signatures = presetSignatures.get(presetId);
  if (!signatures) {
    const built = preset.create();
    signatures = new Set(built.exposed.map((item) => controlSignature(built, item)));
    presetSignatures.set(presetId, signatures);
  }
  return signatures.has(controlSignature(definition, exposed));
}

export function getFlockNumberSensitivity(descriptor: FlockParamDescriptor, min?: number, max?: number): number {
  if (min !== undefined && max !== undefined && Number.isFinite(max - min) && max > min) {
    return Math.max(0.001, (max - min) / 200);
  }
  return descriptor.step ?? 0.5;
}

/**
 * Slider and typed-value limits of a promoted number: the slider spans the declared range unless it
 * is open or far wider than the value's scale (Size 0–200 at 6), then about four times the default;
 * typing reaches the declared limits. The slider always includes the current value.
 */
export function flockSliderRange(
  exposed: { min?: number; max?: number },
  descriptor: FlockParamDescriptor,
  value: number,
): { min: number; max: number; step: number; hardMin: number; hardMax: number } {
  const fallback = typeof descriptor.default === 'number' ? descriptor.default : 0;
  const hardMin = exposed.min ?? descriptor.min ?? Number.NEGATIVE_INFINITY;
  const hardMax = exposed.max ?? descriptor.max ?? Number.POSITIVE_INFINITY;
  // Earlier Add pickers copied the descriptor's limits onto the control: only a narrower max is its own.
  const ownMax = exposed.max !== undefined && exposed.max !== descriptor.max ? exposed.max : undefined;
  const scale = Math.max(1, Math.abs(fallback) * 4);
  // An open lower limit starts the slider at 0 for a positive default (Turbulence), typing goes below.
  const low = Number.isFinite(hardMin) ? hardMin : fallback >= 0 ? 0 : -scale;
  const declared = ownMax ?? (descriptor.max !== undefined && descriptor.max - low <= Math.max(1, Math.abs(fallback) * 20) ? descriptor.max : undefined);
  const high = declared ?? Math.min(hardMax, Math.max(low + scale, scale));
  const step = descriptor.step ?? (high - low <= 2 ? 0.01 : high - low <= 20 ? 0.1 : 1);
  return { min: Math.min(low, value), max: Math.max(high, value), step, hardMin, hardMax };
}

export function clampFlockNumber(value: number, min?: number, max?: number): number {
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

export function formatFlockBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const FLOCK_POPULATION_HINT =
  'Population is structural and cannot be keyframed. Animate the emitter Active Fraction or Lifetime instead.';

/** The slider spans 100 to 100 000 points on a logarithmic scale; typing reaches the node's own limits. */
export const FLOCK_POPULATION_SLIDER = { min: 100, max: 100_000 } as const;

/** A slider position (log10 of the count) as a count with two significant digits: 4000, 12 000, 350. */
export function populationFromSlider(position: number): number {
  const count = 10 ** position, unit = 10 ** Math.max(0, Math.floor(Math.log10(count)) - 1);
  return Math.round(count / unit) * unit;
}

