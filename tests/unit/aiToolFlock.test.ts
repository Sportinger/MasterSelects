import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeAITool } from '../../src/services/aiTools';
import { flockToolDefinitions } from '../../src/services/aiTools/definitions/flock';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import {
  handleAddFlockNode,
  handleApplyFlockPreset,
  handleCreateFlockClip,
  handleExposeFlockParam,
  handleGetFlockClip,
  handleListFlockOperators,
  handleRemoveFlockNodes,
  handleUpdateFlockNode,
} from '../../src/services/aiTools/handlers/flock';
import { handleAddKeyframe, handleGetKeyframes } from '../../src/services/aiTools/handlers/keyframes';
import { getRegisteredToolPolicyNames, getToolPolicy } from '../../src/services/aiTools/policy/registry';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';
import { FLASHBOARD_CHAT_TOOLS } from '../../src/services/flashboard/FlashBoardChatTools';
import { buildHostedAgentFastV2EditorToolCatalog } from '../../src/services/kernelClient/hostedAgent/fastV2EditorToolCatalog';
import { compileFlockDefinition } from '../../src/services/flock/compiler/flockCompiler';
import {
  getHistoryStateView,
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

const FLOCK_TOOL_NAMES = [
  'listFlockOperators',
  'createFlockClip',
  'getFlockClip',
  'applyFlockPreset',
  'addFlockNode',
  'updateFlockNode',
  'removeFlockNodes',
  'connectFlockPorts',
  'disconnectFlockEdge',
  'exposeFlockParam',
  'unexposeFlockParam',
  'scheduleFlockPrecompute',
  'cancelFlockPrecompute',
  'sampleFlockParticles',
] as const;

const READ_ONLY_FLOCK_TOOLS = new Set<string>(['listFlockOperators', 'getFlockClip', 'sampleFlockParticles']);

type FlockView = {
  clipId: string;
  trackId: string;
  valid: boolean;
  capacity: number;
  nodes: Array<{ id: string; operator: string; label?: string; params?: Record<string, unknown> }>;
  edges: Array<{ id: string; from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>;
  exposed: Array<{ id: string; nodeId: string; param: string; keyframeProperties: string[] }>;
};

function resetTimeline(): void {
  useTimelineStore.setState({
    ...initialTimelineState,
    clips: [],
    tracks: [
      { id: 'video-locked', name: 'Locked', type: 'video', height: 70, muted: false, visible: true, solo: false, locked: true },
      { id: 'video-1', name: 'Video 1', type: 'video', height: 70, muted: false, visible: true, solo: false },
      { id: 'audio-1', name: 'Audio', type: 'audio', height: 48, muted: false, visible: true, solo: false },
    ],
    playheadPosition: 1,
    clipKeyframes: new Map(),
  });
}

function initializeHistory(): void {
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: useMediaStore.setState },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  });
}

async function createClip(args: Record<string, unknown> = {}): Promise<FlockView> {
  const result = await handleCreateFlockClip({ presetId: 'free-swarm', duration: 8, ...args }, useTimelineStore.getState());
  expect(result.success, result.error).toBe(true);
  const view = await handleGetFlockClip({ clipId: (result.data as FlockView).clipId });
  expect(view.success).toBe(true);
  return view.data as FlockView;
}

function nodeOf(view: FlockView, operator: string) {
  const node = view.nodes.find((candidate) => candidate.operator === operator);
  if (!node) throw new Error(`missing ${operator}`);
  return node;
}

describe('AI Flock tools', () => {
  beforeEach(() => {
    useMediaStore.setState(initialMediaState);
    resetTimeline();
    setHistoryDisabledForDebug(false);
    initializeHistory();
    getHistoryStateView().clearHistory();
  });

  afterEach(() => {
    getHistoryStateView().clearHistory();
    useTimelineStore.setState(initialTimelineState);
    useMediaStore.setState(initialMediaState);
  });

  it('keeps definitions, handlers, policies and mutation classification in parity', () => {
    expect(flockToolDefinitions.map((tool) => tool.function.name)).toEqual(FLOCK_TOOL_NAMES);
    const handlers = new Set(getRegisteredToolHandlerNames());
    const policies = new Set(getRegisteredToolPolicyNames());
    for (const name of FLOCK_TOOL_NAMES) {
      expect(handlers.has(name), `${name} handler`).toBe(true);
      expect(policies.has(name), `${name} policy`).toBe(true);
      if (READ_ONLY_FLOCK_TOOLS.has(name)) {
        expect(getToolPolicy(name)?.readOnly, `${name} read-only`).toBe(true);
        expect(MODIFYING_TOOLS.has(name), `${name} not modifying`).toBe(false);
      } else {
        expect(getToolPolicy(name)?.readOnly, `${name} mutating`).toBe(false);
        expect(MODIFYING_TOOLS.has(name), `${name} history`).toBe(true);
      }
    }
    expect(getToolPolicy('sampleFlockParticles')?.allowedCallers).not.toContain('chat');
  });

  it('reaches FlashBoard chat and the kernel catalog, but keeps particle dumps out', () => {
    const chatNames = new Set(FLASHBOARD_CHAT_TOOLS.map((tool) => tool.function.name));
    const catalogNames = new Set(buildHostedAgentFastV2EditorToolCatalog().tools.map((tool) => tool.name));
    for (const name of FLOCK_TOOL_NAMES.filter((tool) => tool !== 'sampleFlockParticles')) {
      expect(catalogNames.has(name), `${name} in Fast V2 catalog`).toBe(true);
    }
    for (const name of ['createFlockClip', 'getFlockClip', 'addFlockNode', 'updateFlockNode', 'connectFlockPorts', 'applyFlockPreset', 'exposeFlockParam', 'listFlockOperators']) {
      expect(chatNames.has(name), `${name} in FlashBoard chat`).toBe(true);
    }
    expect(chatNames.has('sampleFlockParticles')).toBe(false);
    expect(catalogNames.has('sampleFlockParticles')).toBe(false);
  });

  it('lists typed operators and presets', async () => {
    const result = await handleListFlockOperators({ category: 'behavior' });
    expect(result.success).toBe(true);
    const data = result.data as { operators: Array<{ id: string; category: string }>; presets: Array<{ id: string }> };
    expect(data.operators.every((operator) => operator.category === 'behavior')).toBe(true);
    expect(data.operators.map((operator) => operator.id)).toContain('flock.vortex');
    expect(data.presets.map((preset) => preset.id)).toContain('violet-filaments');
    expect((await handleListFlockOperators({ category: 'nope' })).success).toBe(false);
  });

  it('creates, wires, updates, exposes and inspects a flock graph', async () => {
    const view = await createClip();
    expect(view.trackId).toBe('video-1');
    expect(view.valid).toBe(true);
    const compose = nodeOf(view, 'flock.compose');

    const added = await handleAddFlockNode({
      clipId: view.clipId,
      operator: 'flock.vortex',
      params: { strength: 12, axis: { x: 0, y: 0, z: 1 } },
      connect: [{ fromPort: 'behavior', toNodeId: compose.id, toPort: 'behavior' }],
    });
    expect(added.success, added.error).toBe(true);
    const { nodeId, animatableProperties } = added.data as { nodeId: string; animatableProperties: string[] };
    expect(animatableProperties).toContain(`flock.node.${nodeId}.strength`);
    const definition = useTimelineStore.getState().clips[0].flock!;
    expect(definition.nodes.find((node) => node.id === nodeId)?.params.axis).toEqual([0, 0, 1]);
    const program = compileFlockDefinition(definition).program!;
    expect(program.ops.map((op) => op.kind)).toEqual(['rules', 'turbulence', 'vortex']);

    const updated = await handleUpdateFlockNode({ clipId: view.clipId, nodeId, params: { strength: 30 }, label: 'Swirl' });
    expect(updated.success, updated.error).toBe(true);
    expect((updated.data as { changed: Array<{ animatable: boolean; keyframeProperties: string[] }> }).changed[0])
      .toMatchObject({ animatable: true, keyframeProperties: [`flock.node.${nodeId}.strength`] });

    const exposed = await handleExposeFlockParam({ clipId: view.clipId, nodeId, param: 'strength', group: 'Guidance' });
    expect(exposed.success, exposed.error).toBe(true);
    const after = (await handleGetFlockClip({ clipId: view.clipId })).data as FlockView;
    expect(after.nodes.find((node) => node.id === nodeId)).toMatchObject({ label: 'Swirl', params: { strength: 30 } });
    expect(after.exposed.find((entry) => entry.nodeId === nodeId)?.keyframeProperties).toEqual([`flock.node.${nodeId}.strength`]);

    const removed = await handleRemoveFlockNodes({ clipId: view.clipId, nodeIds: [nodeId] });
    expect(removed.success).toBe(true);
    expect(useTimelineStore.getState().clips[0].flock!.exposed.some((entry) => entry.nodeId === nodeId)).toBe(false);
  });

  it('rejects invalid wiring and parameters without writing anything', async () => {
    const view = await createClip();
    const simulation = nodeOf(view, 'flock.simulation');
    const emitter = nodeOf(view, 'flock.emitter');
    const before = useTimelineStore.getState().clips[0].flock!;

    const mismatch = await handleAddFlockNode({
      clipId: view.clipId,
      operator: 'flock.vortex',
      connect: [{ fromPort: 'behavior', toNodeId: simulation.id, toPort: 'spawn' }],
    });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error).toMatch(/port signal types or formats do not match/);
    expect(useTimelineStore.getState().clips[0].flock).toBe(before);

    const invalid = await handleUpdateFlockNode({ clipId: view.clipId, nodeId: emitter.id, params: { count: -5 } });
    expect(invalid.success).toBe(false);
    expect((await handleUpdateFlockNode({ clipId: view.clipId, nodeId: emitter.id, params: { nope: 1 } })).success).toBe(false);
    expect(useTimelineStore.getState().clips[0].flock).toBe(before);

    expect((await handleCreateFlockClip({ trackId: 'video-locked' }, useTimelineStore.getState())).success).toBe(false);
    expect((await handleCreateFlockClip({ presetId: 'missing' }, useTimelineStore.getState())).success).toBe(false);
    expect((await handleApplyFlockPreset({ clipId: view.clipId, presetId: 'missing' })).success).toBe(false);
  });

  it('authors flock keyframes in simulation source time through addKeyframe', async () => {
    const view = await createClip();
    const rules = nodeOf(view, 'flock.rules');
    const property = `flock.node.${rules.id}.cohesion`;
    // Show source seconds 2..10 (as after a split / left trim).
    useTimelineStore.setState({
      clips: useTimelineStore.getState().clips.map((clip) => ({ ...clip, inPoint: 2, outPoint: 10, duration: 8 })),
    });

    const local = await handleAddKeyframe({ clipId: view.clipId, property, value: 2, time: 1, easing: 'linear' }, useTimelineStore.getState());
    expect(local.success, local.error).toBe(true);
    expect(local.data).toMatchObject({ resolvedTime: 3, clipLocalTime: 1, timeBasis: 'source', created: true });

    const bySource = await handleAddKeyframe({ clipId: view.clipId, property, value: 4, sourceTime: 6, easing: 'linear' }, useTimelineStore.getState());
    expect(bySource.success, bySource.error).toBe(true);
    expect(bySource.data).toMatchObject({ resolvedTime: 6, clipLocalTime: 4 });

    const listed = await handleGetKeyframes({ clipId: view.clipId, property }, useTimelineStore.getState());
    expect((listed.data as { keyframes: Array<{ time: number; clipLocalTime: number; timeBasis: string }> }).keyframes)
      .toEqual([
        expect.objectContaining({ time: 3, clipLocalTime: 1, timeBasis: 'source' }),
        expect.objectContaining({ time: 6, clipLocalTime: 4, timeBasis: 'source' }),
      ]);

    const outside = await handleAddKeyframe({ clipId: view.clipId, property, value: 1, sourceTime: 0.5 }, useTimelineStore.getState());
    expect(outside.success).toBe(false);
    expect(outside.error).toMatch(/outside the visible source window/);
    const wrongProperty = await handleAddKeyframe({ clipId: view.clipId, property: 'opacity', value: 1, sourceTime: 3 }, useTimelineStore.getState());
    expect(wrongProperty.success).toBe(false);
  });

  it('runs mutating flock tools through the policy-checked executor with one history step', async () => {
    const created = await executeAITool('createFlockClip', { presetId: 'vortex' }, 'devBridge');
    expect(created.success, created.error).toBe(true);
    const clipId = (created.data as { clipId: string }).clipId;
    const read = await executeAITool('getFlockClip', { clipId, includeGraph: false }, 'chat');
    expect(read.success, read.error).toBe(true);
    expect((read.data as { edgeCount: number }).edgeCount).toBeGreaterThan(0);
    expect(useTimelineStore.getState().clips.some((clip) => clip.id === clipId)).toBe(true);
  });
});
