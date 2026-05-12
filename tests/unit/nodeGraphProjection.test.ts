import { describe, expect, it } from 'vitest';
import {
  addClipCustomNodeDefinition,
  buildClipNodeGraph,
  cloneClipNodeGraph,
  createClipAICustomNodeDefinition,
  createClipNodeGraphState,
  remapClipNodeGraphEffectIds,
  showClipBuiltInNode,
  updateClipCustomNodeDefinition,
  updateClipNodeGraphLayout,
} from '../../src/services/nodeGraph';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { createDefaultColorCorrectionState, type ClipMask, type Effect, type TimelineClip, type TimelineTrack } from '../../src/types';

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4', { type: 'video/mp4' }),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

function createTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'video-1',
    name: 'Video 1',
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
    ...overrides,
  };
}

function createMask(overrides: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'mask-1',
    name: 'Mask 1',
    vertices: [
      { id: 'v1', x: 0.2, y: 0.2, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
      { id: 'v2', x: 0.8, y: 0.2, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
      { id: 'v3', x: 0.8, y: 0.8, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
    ],
    closed: true,
    opacity: 1,
    feather: 0,
    featherQuality: 1,
    inverted: false,
    mode: 'add',
    expanded: false,
    position: { x: 0, y: 0 },
    enabled: true,
    visible: true,
    ...overrides,
  };
}

describe('buildClipNodeGraph', () => {
  it('projects a basic video clip as Source into Clip Output', () => {
    const graph = buildClipNodeGraph(createClip(), createTrack());

    expect(graph.id).toBe('clip-graph:clip-1');
    expect(graph.owner).toEqual({ kind: 'clip', id: 'clip-1', name: 'Clip' });
    expect(graph.nodes.map((node) => [node.id, node.kind, node.label])).toEqual([
      ['source', 'source', 'video Source'],
      ['output', 'output', 'Clip Output'],
    ]);
    expect(graph.nodes.find((node) => node.id === 'source')?.outputs.map((port) => port.id)).toEqual([
      'texture',
      'time',
      'metadata',
      'audio',
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromNodeId: 'source',
        fromPortId: 'texture',
        toNodeId: 'output',
        toPortId: 'input',
        type: 'texture',
      }),
      expect.objectContaining({
        fromNodeId: 'source',
        fromPortId: 'time',
        toNodeId: 'output',
        toPortId: 'time',
        type: 'time',
      }),
      expect.objectContaining({
        fromNodeId: 'source',
        fromPortId: 'metadata',
        toNodeId: 'output',
        toPortId: 'metadata',
        type: 'metadata',
      }),
    ]));
    expect(graph.nodes.find((node) => node.id === 'audio-output')).toBeUndefined();
  });

  it('inserts Transform for non-default transforms', () => {
    const transform = structuredClone(DEFAULT_TRANSFORM);
    transform.position.x = 24;
    transform.scale.y = 0.75;
    const graph = buildClipNodeGraph(createClip({ transform }), createTrack());

    expect(graph.nodes.map((node) => node.id)).toEqual(['source', 'transform', 'output']);
    expect(graph.nodes.find((node) => node.id === 'transform')).toMatchObject({
      kind: 'transform',
      label: 'Transform',
      params: {
        x: 24,
        y: 0,
        scaleX: 1,
        scaleY: 0.75,
        speed: 1,
        reversed: false,
      },
    });
    expect(graph.edges.filter((edge) => edge.type === 'texture' && edge.toPortId === 'input').map((edge) => [
      edge.fromNodeId,
      edge.fromPortId,
      edge.toNodeId,
      edge.toPortId,
    ])).toEqual([
      ['source', 'texture', 'transform', 'input'],
      ['transform', 'output', 'output', 'input'],
    ]);
  });

  it('projects masks, color, and visual effects in order', () => {
    const blur: Effect = {
      id: 'blur',
      name: 'Blur',
      type: 'blur',
      enabled: true,
      params: { radius: 12 },
    };
    const contrast: Effect = {
      id: 'contrast',
      name: 'Contrast',
      type: 'contrast',
      enabled: false,
      params: {},
    };
    const colorCorrection = createDefaultColorCorrectionState();
    const graph = buildClipNodeGraph(createClip({
      masks: [
        createMask({ id: 'active-mask' }),
        createMask({ id: 'disabled-mask', enabled: false }),
      ],
      colorCorrection,
      effects: [blur, contrast],
    }), createTrack());

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'source',
      'mask',
      'color',
      'effect-blur',
      'effect-contrast',
      'output',
    ]);
    expect(graph.nodes.map((node) => node.kind)).toEqual([
      'source',
      'mask',
      'color',
      'effect',
      'effect',
      'output',
    ]);
    expect(graph.nodes.find((node) => node.id === 'mask')?.params).toEqual({ masks: 1 });
    expect(graph.nodes.find((node) => node.id === 'color')?.params).toEqual({ nodes: 3, version: 'A' });
    expect(graph.nodes.find((node) => node.id === 'effect-blur')?.params).toEqual({ enabled: true, params: 1 });
    expect(graph.nodes.find((node) => node.id === 'effect-contrast')?.params).toEqual({ enabled: false, params: 0 });
    expect(graph.edges.filter((edge) => edge.type === 'texture' && edge.toPortId === 'input').map((edge) => [
      edge.fromNodeId,
      edge.toNodeId,
    ])).toEqual([
      ['source', 'mask'],
      ['mask', 'color'],
      ['color', 'effect-blur'],
      ['effect-blur', 'effect-contrast'],
      ['effect-contrast', 'output'],
    ]);
  });

  it('projects audio effects into a separate audio lane and output', () => {
    const audioVolume: Effect = {
      id: 'volume',
      name: 'Volume',
      type: 'audio-volume',
      enabled: true,
      params: { gain: 0.8 },
    };
    const audioEq: Effect = {
      id: 'eq',
      name: 'EQ',
      type: 'audio-eq',
      enabled: true,
      params: { low: -2, high: 3 },
    };
    const graph = buildClipNodeGraph(createClip({ effects: [audioVolume, audioEq] }), createTrack());
    const visualOutput = graph.nodes.find((node) => node.id === 'output');
    const audioOutput = graph.nodes.find((node) => node.id === 'audio-output');
    const audioEffectNodes = graph.nodes.filter((node) => node.id === 'effect-volume' || node.id === 'effect-eq');

    expect(graph.nodes.map((node) => node.id)).toEqual([
      'source',
      'output',
      'effect-volume',
      'effect-eq',
      'audio-output',
    ]);
    expect(audioOutput).toMatchObject({
      kind: 'output',
      label: 'Audio Output',
      inputs: expect.arrayContaining([expect.objectContaining({ id: 'input', type: 'audio' })]),
    });
    expect(audioEffectNodes.map((node) => node.layout.y)).toEqual([audioOutput?.layout.y, audioOutput?.layout.y]);
    expect(audioOutput?.layout.y).not.toBe(visualOutput?.layout.y);
    expect(graph.edges.filter((edge) => edge.type === 'audio' && edge.toPortId === 'input').map((edge) => [
      edge.fromNodeId,
      edge.fromPortId,
      edge.toNodeId,
      edge.toPortId,
    ])).toEqual([
      ['source', 'audio', 'effect-volume', 'input'],
      ['effect-volume', 'output', 'effect-eq', 'input'],
      ['effect-eq', 'output', 'audio-output', 'input'],
    ]);
  });

  it('applies persisted node layout from clip graph state', () => {
    const clip = createClip();
    const nodeGraph = updateClipNodeGraphLayout(clip, 'source', { x: 44, y: 55 }, createTrack());
    const graph = buildClipNodeGraph({ ...clip, nodeGraph }, createTrack());

    expect(graph.nodes.find((node) => node.id === 'source')?.layout).toEqual({ x: 44, y: 55 });
    expect(graph.nodes.find((node) => node.id === 'output')?.layout).toEqual({ x: 230, y: 88 });
  });

  it('reconciles saved layout when graph shape changes', () => {
    const clip = createClip();
    const nodeGraph = updateClipNodeGraphLayout(clip, 'source', { x: 12, y: 34 }, createTrack());
    const transform = structuredClone(DEFAULT_TRANSFORM);
    transform.position.x = 10;
    const graph = buildClipNodeGraph({ ...clip, transform, nodeGraph }, createTrack());

    expect(graph.nodes.map((node) => node.id)).toEqual(['source', 'transform', 'output']);
    expect(graph.nodes.find((node) => node.id === 'source')?.layout).toEqual({ x: 12, y: 34 });
    expect(graph.nodes.find((node) => node.id === 'transform')?.layout).toEqual({ x: 230, y: 88 });
  });

  it('stores field-backed node states without duplicating clip params', () => {
    const blur: Effect = {
      id: 'blur',
      name: 'Blur',
      type: 'blur',
      enabled: true,
      params: { radius: 12 },
    };
    const state = createClipNodeGraphState(createClip({ effects: [blur] }), createTrack());

    expect(state.nodes.map((node) => [node.id, node.backing.kind])).toEqual([
      ['source', 'clip-source'],
      ['effect-blur', 'clip-effect'],
      ['output', 'clip-output'],
    ]);
    expect(state.nodes.find((node) => node.id === 'effect-blur')?.backing).toEqual({
      kind: 'clip-effect',
      effectId: 'blur',
    });
  });

  it('clones and remaps persisted effect node ids for pasted clips', () => {
    const blur: Effect = {
      id: 'blur',
      name: 'Blur',
      type: 'blur',
      enabled: true,
      params: { radius: 12 },
    };
    const state = updateClipNodeGraphLayout(
      createClip({ effects: [blur] }),
      'effect-blur',
      { x: 500, y: 99 },
      createTrack(),
    );
    const cloned = cloneClipNodeGraph(state);
    const remapped = remapClipNodeGraphEffectIds(cloned, new Map([['blur', 'new-blur']]));

    expect(cloned).not.toBe(state);
    expect(remapped?.nodes.find((node) => node.id === 'effect-new-blur')).toMatchObject({
      backing: { kind: 'clip-effect', effectId: 'new-blur' },
      layout: { x: 500, y: 99 },
    });
  });

  it('projects AI custom nodes from clip graph state into the main signal chain', () => {
    const clip = createClip();
    const track = createTrack();
    const definition = createClipAICustomNodeDefinition('custom-ai', clip, 'AI Node');
    const nodeGraph = addClipCustomNodeDefinition(clip, definition, track);
    const graph = buildClipNodeGraph({ ...clip, nodeGraph }, track);

    expect(graph.nodes.map((node) => [node.id, node.kind, node.runtime])).toEqual([
      ['source', 'source', 'builtin'],
      ['custom-ai', 'custom', 'typescript'],
      ['output', 'output', 'builtin'],
    ]);
    expect(graph.nodes.find((node) => node.id === 'custom-ai')).toMatchObject({
      label: 'AI Node',
      params: { status: 'draft', prompt: 'empty' },
    });
    expect(nodeGraph.nodes.find((node) => node.id === 'custom-ai')?.backing).toEqual({
      kind: 'clip-custom-node',
      nodeId: 'custom-ai',
    });
    expect(graph.edges.filter((edge) => edge.type === 'texture' && edge.toPortId === 'input').map((edge) => [
      edge.fromNodeId,
      edge.toNodeId,
    ])).toEqual([
      ['source', 'custom-ai'],
      ['custom-ai', 'output'],
    ]);
  });

  it('updates and clones AI custom node authoring state', () => {
    const clip = createClip();
    const track = createTrack();
    const definition = createClipAICustomNodeDefinition('custom-ai', clip, 'AI Node');
    const nodeGraph = addClipCustomNodeDefinition(clip, definition, track);
    const updated = updateClipCustomNodeDefinition(
      { ...clip, nodeGraph },
      'custom-ai',
      {
        label: 'Motion Curve Builder',
        status: 'ready',
        ai: {
          prompt: 'Create a motion curve from the incoming video.',
          generatedCode: 'defineNode({ /* generated */ })',
        },
      },
      track,
    );
    const cloned = cloneClipNodeGraph(updated);

    expect(updated.customNodes?.[0]).toMatchObject({
      id: 'custom-ai',
      label: 'Motion Curve Builder',
      status: 'ready',
      ai: {
        prompt: 'Create a motion curve from the incoming video.',
        generatedCode: 'defineNode({ /* generated */ })',
      },
    });
    expect(cloned).not.toBe(updated);
    expect(cloned?.customNodes?.[0]).not.toBe(updated.customNodes?.[0]);
    expect(cloned?.customNodes?.[0]?.ai).toEqual(updated.customNodes?.[0]?.ai);
  });

  it('can force field-backed built-in nodes to stay visible from graph authoring', () => {
    const clip = createClip();
    const track = createTrack();
    const withTransform = showClipBuiltInNode(clip, 'transform', track);
    const withColor = showClipBuiltInNode({ ...clip, nodeGraph: withTransform }, 'color', track);
    const graph = buildClipNodeGraph({ ...clip, nodeGraph: withColor }, track);

    expect(graph.nodes.map((node) => node.id)).toEqual(['source', 'transform', 'color', 'output']);
    expect(withColor.forcedBuiltIns).toEqual(['transform', 'color']);
    expect(cloneClipNodeGraph(withColor)?.forcedBuiltIns).toEqual(['transform', 'color']);
  });
});
