import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  MotionModifierContractError,
  parseMotionModifierStackContract,
  type MotionModifier,
  type MotionModifierDiagnostic,
  type MotionModifierStackContractV1,
} from './contracts';

export type MotionModifierSemanticOperation =
  | { type: 'add'; kind: MotionModifier['kind']; enabled?: boolean; target?: { path: string; operation: string; amount: number }; fields?: Record<string, unknown> }
  | { type: 'update'; modifierId: string; enabled?: boolean; target?: { path: string; operation: string; amount: number }; fields?: Record<string, unknown> }
  | { type: 'remove'; modifierId: string }
  | { type: 'reorder'; modifierId: string; newIndex: number }
  | { type: 'set-falloff'; falloff: { shapeClipId: string; shapeRevision: number; feather: number; invert: boolean; clip: boolean }; referencedShapeRevision?: number }
  | { type: 'clear-falloff' };

export interface MotionModifierSemanticOperationPlanSuccess { ok: true; operation: MotionModifierSemanticOperation['type']; previousRevision: number; nextRevision: number; changed: true; contract: MotionModifierStackContractV1; diagnostics: []; }
export interface MotionModifierSemanticOperationPlanFailure { ok: false; operation: null; previousRevision: null; nextRevision: null; changed: false; contract: null; diagnostics: readonly MotionModifierDiagnostic[]; }
export type MotionModifierSemanticOperationPlan = MotionModifierSemanticOperationPlanSuccess | MotionModifierSemanticOperationPlanFailure;

function fail(error: unknown): MotionModifierSemanticOperationPlanFailure {
  const contractError = error instanceof MotionModifierContractError ? error : undefined;
  return { ok: false, operation: null, previousRevision: null, nextRevision: null, changed: false, contract: null, diagnostics: [{ code: contractError?.code ?? 'MOTION_MODIFIER_INVALID_CONTRACT', severity: 'error', message: error instanceof Error ? error.message : String(error), ...(contractError?.path ? { path: contractError.path } : {}), ...(contractError?.limit !== undefined ? { limit: contractError.limit } : {}), ...(contractError?.actual !== undefined ? { actual: contractError.actual } : {}) }] };
}
function reindex(modifiers: MotionModifier[]): MotionModifier[] { return modifiers.map((modifier, order) => ({ ...modifier, order } as MotionModifier)); }
function defaults(kind: MotionModifier['kind'], id: string, target: unknown, enabled: boolean, fields: Record<string, unknown>): MotionModifier {
  const base = { id, order: 0, enabled, targets: [target] };
  if (kind === 'random') return { ...base, kind, seed: fields.seed ?? 0, distribution: 'uniform-signed' } as MotionModifier;
  if (kind === 'noise') return { ...base, kind, seed: fields.seed ?? 0, indexFrequency: fields.indexFrequency ?? 1, timeFrequencyHz: fields.timeFrequencyHz ?? 0, octaves: fields.octaves ?? 1, lacunarity: fields.lacunarity ?? 2, persistence: fields.persistence ?? 0.5 } as MotionModifier;
  if (kind === 'oscillator') return { ...base, kind, waveform: fields.waveform ?? 'sine', frequencyHz: fields.frequencyHz ?? 1, cyclesAcrossInstances: fields.cyclesAcrossInstances ?? 0, phaseDegrees: fields.phaseDegrees ?? 0 } as MotionModifier;
  return { ...base, kind, field: fields.field ?? 'radial-distance', center: { x: fields.centerX ?? 0, y: fields.centerY ?? 0 }, radius: fields.radius ?? 100, exponent: fields.exponent ?? 1 } as MotionModifier;
}
function validateFields(kind: MotionModifier['kind'], fields: Record<string, unknown>): void {
  const allowed: Record<MotionModifier['kind'], readonly string[]> = { random: ['seed'], noise: ['seed', 'indexFrequency', 'timeFrequencyHz', 'octaves', 'lacunarity', 'persistence'], oscillator: ['waveform', 'frequencyHz', 'cyclesAcrossInstances', 'phaseDegrees'], field: ['field', 'centerX', 'centerY', 'radius', 'exponent'] };
  for (const key of Object.keys(fields)) if (!allowed[kind].includes(key)) throw new Error(`${key} is not supported for ${kind} modifiers`);
}

/** Pure MD4 authoring planner. The handler must parse its contract again before commit. */
export function planMotionModifierSemanticOperation(currentValue: MotionModifierStackContractV1 | undefined, operation: MotionModifierSemanticOperation): MotionModifierSemanticOperationPlan {
  try {
    const current = currentValue === undefined ? undefined : parseMotionModifierStackContract(currentValue);
    const previousRevision = current?.revision ?? 0;
    if (previousRevision === Number.MAX_SAFE_INTEGER) throw new Error('Modifier stack revision cannot advance beyond Number.MAX_SAFE_INTEGER');
    const base: MotionModifierStackContractV1 = current ?? { contract: MOTION_MODIFIER_CONTRACT_ID, version: MOTION_MODIFIER_CONTRACT_VERSION, revision: 0, timeBasis: 'clip-local-seconds', ticksPerSecond: 60, modifiers: [] };
    let candidate: MotionModifierStackContractV1;
    if (operation.type === 'add') {
      if (!['random', 'noise', 'oscillator', 'field'].includes(operation.kind)) throw new Error('Unsupported modifier kind');
      const fields = operation.fields ?? {}; validateFields(operation.kind, fields);
      if (!operation.target) throw new Error('add requires a target');
      candidate = { ...base, modifiers: reindex([...base.modifiers, defaults(operation.kind, `modifier-${previousRevision + 1}-${base.modifiers.length}`, operation.target, operation.enabled ?? true, fields)]) };
    } else if (operation.type === 'update') {
      const index = base.modifiers.findIndex((modifier) => modifier.id === operation.modifierId); if (index < 0) throw new Error(`Modifier not found: ${operation.modifierId}`);
      const existing = base.modifiers[index]; const fields = operation.fields ?? {}; validateFields(existing.kind, fields);
      const updated: any = { ...existing, ...(operation.enabled === undefined ? {} : { enabled: operation.enabled }), ...fields };
      if (existing.kind === 'field' && ('centerX' in fields || 'centerY' in fields)) { updated.center = { x: fields.centerX ?? existing.center.x, y: fields.centerY ?? existing.center.y }; delete updated.centerX; delete updated.centerY; }
      if (operation.target) { const targetIndex = existing.targets.findIndex((target) => target.path === operation.target!.path); updated.targets = targetIndex < 0 ? [...existing.targets, operation.target] : existing.targets.map((target, i) => i === targetIndex ? operation.target : target); }
      candidate = { ...base, modifiers: reindex(base.modifiers.map((modifier, i) => i === index ? updated : modifier)) };
    } else if (operation.type === 'remove') {
      if (!base.modifiers.some((modifier) => modifier.id === operation.modifierId)) throw new Error(`Modifier not found: ${operation.modifierId}`);
      candidate = { ...base, modifiers: reindex(base.modifiers.filter((modifier) => modifier.id !== operation.modifierId)) };
    } else if (operation.type === 'reorder') {
      const index = base.modifiers.findIndex((modifier) => modifier.id === operation.modifierId); if (index < 0) throw new Error(`Modifier not found: ${operation.modifierId}`); if (!Number.isSafeInteger(operation.newIndex) || operation.newIndex < 0 || operation.newIndex >= base.modifiers.length) throw new Error('newIndex is outside the modifier stack');
      const modifiers = [...base.modifiers]; const [modifier] = modifiers.splice(index, 1); modifiers.splice(operation.newIndex, 0, modifier); candidate = { ...base, modifiers: reindex(modifiers) };
    } else if (operation.type === 'set-falloff') candidate = {
      ...base,
      falloff: {
        ...operation.falloff,
        shapeRevision: operation.referencedShapeRevision ?? 0,
      },
    };
    else { const { falloff: _falloff, ...withoutFalloff } = base; candidate = withoutFalloff; }
    const contract = parseMotionModifierStackContract({ ...candidate, revision: previousRevision + 1 });
    return { ok: true, operation: operation.type, previousRevision, nextRevision: contract.revision, changed: true, contract, diagnostics: [] };
  } catch (error) { return fail(error); }
}
