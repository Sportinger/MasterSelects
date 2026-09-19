import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import {
  createFlockProperty,
  type FlockDefinition,
  type FlockParamValue,
  type FlockPortRef,
} from '../../../types/flock';
import { compileFlockDefinitionCached } from '../../flock/compiler/flockCompiler';
import {
  FLOCK_GROUP_OPERATOR_ID,
  getFlockOperator,
  listFlockOperators,
} from '../../flock/operators/flockOperatorRegistry';
import { FLOCK_CATEGORY_LABELS, type FlockOperatorCategory } from '../../flock/operators/flockOperatorTypes';
import { FLOCK_PRESETS, getFlockPreset } from '../../flock/presets/flockPresets';
import {
  addFlockNode,
  connectFlockPorts,
  renameFlockNode,
  setFlockNodeBypass,
  setFlockNodeParam,
} from '../../flock/mutations/flockGraphMutations';
import { readFlockParamValue, resolveFlockParamDescriptor } from '../../flock/flockPropertyValues';
import { flockRuntime } from '../../../engine/flock/runtime/flockRuntimeApi';
import { selectClipAndOpenTab } from '../aiFeedback';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const MAX_LISTED_PARAMS = 48;

function failure(error: string): ToolResult {
  return { success: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalFinite(value: unknown, field: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${field} must be a finite number >= ${min}`);
  }
  return value;
}

function getFlockClip(clipId: unknown): TimelineClip {
  const id = requireString(clipId, 'clipId');
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === id);
  if (!clip) throw new Error(`Clip not found: ${id}`);
  if (clip.source?.type !== 'flock' || !clip.flock) throw new Error(`Clip ${id} is not a flock clip`);
  return clip;
}

function errorResult(error: unknown): ToolResult {
  return failure(error instanceof Error ? error.message : String(error));
}

/** Accepts [x, y, z] or {x, y, z} for vec3 parameters; everything else passes through. */
function coerceParamValue(definition: FlockDefinition, nodeId: string, paramId: string, raw: unknown): FlockParamValue {
  const descriptor = resolveFlockParamDescriptor(definition, nodeId, paramId);
  if (!descriptor) throw new Error(`Node ${nodeId} has no parameter ${paramId}`);
  if (descriptor.type === 'vec3' && isRecord(raw)) {
    const current = readFlockParamValue(definition, nodeId, paramId);
    const base = Array.isArray(current) ? current : [0, 0, 0];
    return [Number(raw.x ?? base[0]), Number(raw.y ?? base[1]), Number(raw.z ?? base[2])];
  }
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.length === 3) return [Number(raw[0]), Number(raw[1]), Number(raw[2])];
  throw new Error(`Parameter ${paramId} has an unsupported value`);
}

function keyframePaths(definition: FlockDefinition, nodeId: string, paramId: string): string[] {
  const descriptor = resolveFlockParamDescriptor(definition, nodeId, paramId);
  if (!descriptor?.animatable) return [];
  if (descriptor.type === 'vec3') return (['x', 'y', 'z'] as const).map((axis) => createFlockProperty(nodeId, paramId, axis));
  if (descriptor.type === 'color') return (['r', 'g', 'b'] as const).map((channel) => createFlockProperty(nodeId, paramId, channel));
  return [createFlockProperty(nodeId, paramId)];
}

export function describeFlockClipForAi(clip: TimelineClip, includeGraph = true) {
  const definition = clip.flock!;
  const compiled = compileFlockDefinitionCached(definition);
  const status = flockRuntime.getStatus(clip.id);
  const keyframedProperties = new Set(
    (useTimelineStore.getState().clipKeyframes.get(clip.id) ?? [])
      .filter((keyframe) => keyframe.property.startsWith('flock.node.'))
      .map((keyframe) => keyframe.property),
  );
  return {
    clipId: clip.id,
    name: clip.name,
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    presetId: definition.presetId ?? null,
    time: definition.time,
    valid: compiled.ok,
    capacity: compiled.ok ? compiled.program.capacity : null,
    stepRate: compiled.ok ? compiled.program.stepRate : null,
    estimatedMemoryBytes: compiled.ok ? compiled.program.estimate.totalBytes : null,
    diagnostics: compiled.diagnostics
      .filter((diagnostic) => diagnostic.severity !== 'info')
      .slice(0, 20)
      .map(({ code, severity, message, nodeIds }) => ({ code, severity, message, ...(nodeIds ? { nodeIds } : {}) })),
    nodes: definition.nodes.map((node) => ({
      id: node.id,
      operator: node.operator,
      ...(node.label ? { label: node.label } : {}),
      ...(node.bypassed ? { bypassed: true } : {}),
      ...(node.groupRef ? { groupRef: node.groupRef } : {}),
      ...(includeGraph
        ? { params: Object.fromEntries(Object.entries(node.params).slice(0, MAX_LISTED_PARAMS)) }
        : {}),
    })),
    ...(includeGraph
      ? { edges: definition.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to })) }
      : { edgeCount: definition.edges.length }),
    exposed: definition.exposed.map((exposed) => ({
      id: exposed.id,
      nodeId: exposed.nodeId,
      param: exposed.param,
      label: exposed.label,
      group: exposed.group,
      keyframeProperties: keyframePaths(definition, exposed.nodeId, exposed.param),
    })),
    groups: definition.groups.map((group) => ({ id: group.id, label: group.label, nodeCount: group.nodes.length })),
    keyframedProperties: [...keyframedProperties].slice(0, 64),
    keyframeTimeBasis: 'source',
    runtime: status
      ? {
          state: status.state,
          ...(status.message ? { message: status.message } : {}),
          aliveCount: status.aliveCount,
          simulatedCount: status.simulatedCount,
          step: status.step,
          targetStep: status.targetStep,
          sourceTime: status.sourceTime,
          memoryBytes: status.memoryBytes,
          neighborLimitedParticles: status.neighborSaturatedCells,
          cache: status.cache,
          runtimeDiagnostics: status.diagnostics
            .filter((diagnostic) => diagnostic.code === 'link-radius-clamped' || diagnostic.code === 'audio-unavailable' || diagnostic.code === 'model-placeholder')
            .map(({ code, message }) => ({ code, message })),
        }
      : { state: 'not-rendered' },
  };
}

export async function handleListFlockOperators(args: Record<string, unknown>): Promise<ToolResult> {
  const category = args.category;
  if (category !== undefined && (typeof category !== 'string' || !(category in FLOCK_CATEGORY_LABELS))) {
    return failure(`category must be one of: ${Object.keys(FLOCK_CATEGORY_LABELS).join(', ')}`);
  }
  const operators = listFlockOperators()
    .filter((operator) => operator.id !== FLOCK_GROUP_OPERATOR_ID)
    .filter((operator) => category === undefined || operator.category === (category as FlockOperatorCategory))
    .map((operator) => ({
      id: operator.id,
      label: operator.label,
      category: operator.category,
      description: operator.description,
      bypass: operator.bypass.kind,
      ...(operator.maxInstances !== undefined ? { maxInstances: operator.maxInstances } : {}),
      inputs: operator.inputs.map((port) => ({
        id: port.id,
        type: port.type,
        ...(port.required ? { required: true } : {}),
        ...(port.repeated ? { repeated: true } : {}),
        ...(port.drivesParam ? { drivesParam: port.drivesParam } : {}),
      })),
      outputs: operator.outputs.map((port) => ({ id: port.id, type: port.type })),
      params: operator.params.map((param) => ({
        id: param.id,
        type: param.type,
        default: param.default,
        ...(param.min !== undefined ? { min: param.min } : {}),
        ...(param.max !== undefined ? { max: param.max } : {}),
        ...(param.options ? { options: param.options.map((option) => option.value) } : {}),
        animatable: param.animatable,
        invalidation: param.invalidation,
      })),
    }));
  return {
    success: true,
    data: {
      operators,
      presets: FLOCK_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, description: preset.description })),
      simulationUnits: '100 simulation units = 1 shared-scene world unit (the frame is 2 world units tall).',
    },
  };
}

export async function handleCreateFlockClip(args: Record<string, unknown>, timelineStore: TimelineStore): Promise<ToolResult> {
  try {
    const tracks = timelineStore.tracks.filter((track) => track.type === 'video');
    let trackId: string;
    if (args.trackId !== undefined) {
      trackId = requireString(args.trackId, 'trackId');
      const track = tracks.find((candidate) => candidate.id === trackId);
      if (!track) return failure(`Video track not found: ${trackId}`);
      if (track.locked) return failure(`Track is locked: ${trackId}`);
    } else {
      const track = tracks.find((candidate) => !candidate.locked && candidate.visible !== false)
        ?? tracks.find((candidate) => !candidate.locked);
      if (!track) return failure('No unlocked video track is available; create a video track first.');
      trackId = track.id;
    }
    const startTime = optionalFinite(args.startTime, 'startTime', 0) ?? timelineStore.playheadPosition;
    const duration = optionalFinite(args.duration, 'duration', Number.EPSILON);
    const presetId = args.presetId === undefined ? undefined : requireString(args.presetId, 'presetId');
    if (presetId && !getFlockPreset(presetId)) {
      return failure(`Unknown presetId ${presetId}. Available: ${FLOCK_PRESETS.map((preset) => preset.id).join(', ')}`);
    }
    const name = args.name === undefined ? undefined : requireString(args.name, 'name');
    const clipId = useTimelineStore.getState().addFlockClip(trackId, startTime, {
      ...(duration !== undefined ? { duration } : {}),
      ...(presetId ? { presetId } : {}),
      ...(name ? { name } : {}),
    });
    if (!clipId) return failure('Could not create the flock clip on that track.');
    selectClipAndOpenTab(clipId, 'flock');
    return { success: true, data: describeFlockClipForAi(getFlockClip(clipId), false) };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleGetFlockClip(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    return { success: true, data: describeFlockClipForAi(clip, args.includeGraph !== false) };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleApplyFlockPreset(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const presetId = requireString(args.presetId, 'presetId');
    if (!getFlockPreset(presetId)) {
      return failure(`Unknown presetId ${presetId}. Available: ${FLOCK_PRESETS.map((preset) => preset.id).join(', ')}`);
    }
    if (!useTimelineStore.getState().applyFlockPreset(clip.id, presetId)) {
      return failure('The preset could not be applied (locked track?).');
    }
    return { success: true, data: describeFlockClipForAi(getFlockClip(clip.id), false) };
  } catch (error) {
    return errorResult(error);
  }
}

function commitDefinition(clipId: string, definition: FlockDefinition): void {
  if (!useTimelineStore.getState().replaceFlockDefinition(clipId, definition)) {
    throw new Error('The flock graph could not be updated (locked track?).');
  }
}

export async function handleAddFlockNode(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const operatorId = requireString(args.operator, 'operator');
    if (operatorId === FLOCK_GROUP_OPERATOR_ID || !getFlockOperator(operatorId)) {
      return failure(`Unknown flock operator ${operatorId}. Use listFlockOperators.`);
    }
    if (args.params !== undefined && !isRecord(args.params)) return failure('params must be an object');
    let definition = clip.flock!;
    const layouts = Object.values(definition.layout);
    const layout = isRecord(args.layout) && Number.isFinite(args.layout.x) && Number.isFinite(args.layout.y)
      ? { x: Number(args.layout.x), y: Number(args.layout.y) }
      : { x: (layouts.length ? Math.max(...layouts.map((entry) => entry.x)) : 0) + 260, y: 0 };
    const added = addFlockNode(definition, operatorId, {
      layout,
      ...(typeof args.label === 'string' && args.label.trim() ? { label: args.label.trim() } : {}),
    });
    if (!added.ok) return failure(added.message);
    definition = added.definition;
    const nodeId = added.nodeId;
    for (const [paramId, raw] of Object.entries((args.params as Record<string, unknown> | undefined) ?? {})) {
      const set = setFlockNodeParam(definition, nodeId, paramId, coerceParamValue(definition, nodeId, paramId, raw));
      if (!set.ok) return failure(`${paramId}: ${set.message}`);
      definition = set.definition;
    }
    const connections: Array<{ edgeId: string; replacedEdgeId?: string }> = [];
    if (args.connect !== undefined && !Array.isArray(args.connect)) return failure('connect must be an array');
    for (const [index, raw] of ((args.connect as unknown[] | undefined) ?? []).entries()) {
      if (!isRecord(raw)) return failure(`connect[${index}] must be an object`);
      const fromPort = requireString(raw.fromPort, `connect[${index}].fromPort`);
      const toPort = requireString(raw.toPort, `connect[${index}].toPort`);
      const hasFrom = typeof raw.fromNodeId === 'string';
      const hasTo = typeof raw.toNodeId === 'string';
      if (hasFrom === hasTo) {
        return failure(`connect[${index}] needs exactly one of fromNodeId (feeds the new node) or toNodeId (fed by the new node)`);
      }
      const from: FlockPortRef = hasFrom ? { nodeId: String(raw.fromNodeId), port: fromPort } : { nodeId, port: fromPort };
      const to: FlockPortRef = hasTo ? { nodeId: String(raw.toNodeId), port: toPort } : { nodeId, port: toPort };
      const connected = connectFlockPorts(definition, from, to);
      if (!connected.ok) return failure(`connect[${index}]: ${connected.message}`);
      definition = connected.definition;
      connections.push({ edgeId: connected.edgeId, ...(connected.replacedEdgeId ? { replacedEdgeId: connected.replacedEdgeId } : {}) });
    }
    commitDefinition(clip.id, definition);
    const updated = getFlockClip(clip.id);
    return {
      success: true,
      data: {
        nodeId,
        connections,
        animatableProperties: getFlockOperator(operatorId)!.params
          .flatMap((param) => keyframePaths(updated.flock!, nodeId, param.id)),
        clip: describeFlockClipForAi(updated, false),
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleUpdateFlockNode(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const nodeId = requireString(args.nodeId, 'nodeId');
    let definition = clip.flock!;
    if (!definition.nodes.some((node) => node.id === nodeId)) return failure(`Node not found: ${nodeId}`);
    if (args.params !== undefined && !isRecord(args.params)) return failure('params must be an object');
    const entries = Object.entries((args.params as Record<string, unknown> | undefined) ?? {});
    if (entries.length === 0 && args.bypassed === undefined && args.label === undefined) {
      return failure('Provide params, bypassed or label');
    }
    const keyframed = new Set<string>((useTimelineStore.getState().clipKeyframes.get(clip.id) ?? []).map((keyframe) => keyframe.property));
    const changed: Array<{ param: string; value: FlockParamValue; animatable: boolean; hiddenByKeyframes: boolean; invalidation: string; keyframeProperties: string[] }> = [];
    for (const [paramId, raw] of entries) {
      const value = coerceParamValue(definition, nodeId, paramId, raw);
      const result = setFlockNodeParam(definition, nodeId, paramId, value);
      if (!result.ok) return failure(`${paramId}: ${result.message}`);
      definition = result.definition;
      const descriptor = resolveFlockParamDescriptor(definition, nodeId, paramId)!;
      const paths = keyframePaths(definition, nodeId, paramId);
      changed.push({
        param: paramId,
        value,
        animatable: descriptor.animatable,
        hiddenByKeyframes: paths.some((path) => keyframed.has(path)),
        invalidation: descriptor.invalidation,
        keyframeProperties: paths,
      });
    }
    if (args.bypassed !== undefined) {
      if (typeof args.bypassed !== 'boolean') return failure('bypassed must be a boolean');
      const result = setFlockNodeBypass(definition, nodeId, args.bypassed);
      if (!result.ok) return failure(result.message);
      definition = result.definition;
    }
    if (args.label !== undefined) {
      if (typeof args.label !== 'string') return failure('label must be a string');
      const result = renameFlockNode(definition, nodeId, args.label);
      if (!result.ok) return failure(result.message);
      definition = result.definition;
    }
    commitDefinition(clip.id, definition);
    return { success: true, data: { nodeId, changed, clip: describeFlockClipForAi(getFlockClip(clip.id), false) } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleRemoveFlockNodes(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    if (!Array.isArray(args.nodeIds) || args.nodeIds.length === 0) return failure('nodeIds must be a non-empty array');
    const nodeIds = args.nodeIds.map((id, index) => requireString(id, `nodeIds[${index}]`));
    const missing = nodeIds.filter((id) => !clip.flock!.nodes.some((node) => node.id === id));
    if (missing.length > 0) return failure(`Nodes not found: ${missing.join(', ')}`);
    if (!useTimelineStore.getState().removeFlockGraphNodes(clip.id, nodeIds)) {
      return failure('The nodes could not be removed (locked track?).');
    }
    return { success: true, data: { removedNodeIds: nodeIds, clip: describeFlockClipForAi(getFlockClip(clip.id), false) } };
  } catch (error) {
    return errorResult(error);
  }
}

function parsePortRef(value: unknown, field: string): FlockPortRef {
  if (!isRecord(value)) throw new Error(`${field} must be {nodeId, port}`);
  return { nodeId: requireString(value.nodeId, `${field}.nodeId`), port: requireString(value.port, `${field}.port`) };
}

export async function handleConnectFlockPorts(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const result = useTimelineStore.getState().connectFlockGraphPorts(clip.id, parsePortRef(args.from, 'from'), parsePortRef(args.to, 'to'));
    if (!result.ok) return failure(result.message);
    return {
      success: true,
      data: {
        edgeId: result.edgeId,
        ...(result.replacedEdgeId ? { replacedEdgeId: result.replacedEdgeId } : {}),
        valid: compileFlockDefinitionCached(getFlockClip(clip.id).flock!).ok,
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleDisconnectFlockEdge(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const edgeId = requireString(args.edgeId, 'edgeId');
    if (!clip.flock!.edges.some((edge) => edge.id === edgeId)) return failure(`Edge not found: ${edgeId}`);
    if (!useTimelineStore.getState().disconnectFlockGraphEdge(clip.id, edgeId)) return failure('The edge could not be removed.');
    return { success: true, data: { removedEdgeId: edgeId, valid: compileFlockDefinitionCached(getFlockClip(clip.id).flock!).ok } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleExposeFlockParam(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const nodeId = requireString(args.nodeId, 'nodeId');
    const param = requireString(args.param, 'param');
    if (!resolveFlockParamDescriptor(clip.flock!, nodeId, param)) return failure(`Node ${nodeId} has no parameter ${param}`);
    const exposedId = useTimelineStore.getState().exposeFlockGraphParam(clip.id, nodeId, param, {
      ...(typeof args.label === 'string' && args.label.trim() ? { label: args.label.trim() } : {}),
      ...(typeof args.group === 'string' && args.group.trim() ? { group: args.group.trim() } : {}),
      ...(optionalFinite(args.min, 'min', -Number.MAX_VALUE) !== undefined ? { min: Number(args.min) } : {}),
      ...(optionalFinite(args.max, 'max', -Number.MAX_VALUE) !== undefined ? { max: Number(args.max) } : {}),
    });
    if (!exposedId) return failure('The parameter could not be exposed.');
    return { success: true, data: { exposedId, keyframeProperties: keyframePaths(clip.flock!, nodeId, param) } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleUnexposeFlockParam(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const exposedId = requireString(args.exposedId, 'exposedId');
    if (!clip.flock!.exposed.some((exposed) => exposed.id === exposedId)) return failure(`Exposed control not found: ${exposedId}`);
    if (!useTimelineStore.getState().unexposeFlockGraphParam(clip.id, exposedId)) return failure('The control could not be removed.');
    return { success: true, data: { removedExposedId: exposedId } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleScheduleFlockPrecompute(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const start = optionalFinite(args.start, 'start', 0);
    const end = optionalFinite(args.end, 'end', 0);
    if (start === undefined || end === undefined) return failure('start and end are required');
    if (end <= start) return failure('end must be greater than start');
    if (args.persist !== undefined && typeof args.persist !== 'boolean') return failure('persist must be a boolean');
    const persist = args.persist === true;
    useTimelineStore.getState().setFlockCacheSettings(clip.id, { precomputeStart: start, precomputeEnd: end, persist });
    const pending = flockRuntime.requestPrecompute(clip.id, { start, end }, { persist });
    const early = await Promise.race([
      pending,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 150)),
    ]);
    if (early && !early.ok) return failure(early.message ?? 'Precompute could not start.');
    return {
      success: true,
      data: {
        clipId: clip.id,
        range: [start, end],
        persist,
        status: early ? 'finished' : 'running',
        hint: 'Poll getFlockClip runtime.cache.precomputeProgress; cancelFlockPrecompute stops it.',
      },
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleCancelFlockPrecompute(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    flockRuntime.cancelPrecompute(clip.id);
    return { success: true, data: { clipId: clip.id, cancelled: true } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleSampleFlockParticles(args: Record<string, unknown>): Promise<ToolResult> {
  try {
    const clip = getFlockClip(args.clipId);
    const maxCount = args.maxCount === undefined ? 32 : Number(args.maxCount);
    if (!Number.isInteger(maxCount) || maxCount < 1 || maxCount > 256) return failure('maxCount must be an integer from 1 to 256');
    const sample = await flockRuntime.sampleParticles(clip.id, maxCount);
    if (!sample) return failure('No live flock preview session for this clip; show it in the preview first.');
    return { success: true, data: { ...sample, layout: ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'group'] } };
  } catch (error) {
    return errorResult(error);
  }
}
