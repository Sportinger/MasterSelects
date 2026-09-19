import { describe, expect, it } from 'vitest';
import {
  buildClipFlockNodeGraph,
  buildClipNodeGraphDocument,
  getClipFlockGraphId,
  getFlockPortType,
  getNodeGraphPortCompatibilityKey,
  getNodeGraphView,
} from '../../src/services/nodeGraph';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import {
  createFlockGroupFromNodes,
  disconnectFlockEdge,
} from '../../src/services/flock/mutations/flockGraphMutations';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { FlockDefinition } from '../../src/types/flock';
import type { TimelineClip, TimelineTrack } from '../../src/types';

function createFlockClip(definition: FlockDefinition = createFlockPresetDefinition('free-swarm')): TimelineClip {
  return {
    id: 'clip-flock-1',
    trackId: 'video-1',
    name: 'Flock',
    file: new File([], 'flock.json', { type: 'application/json' }),
    startTime: 0,
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    source: { type: 'flock', naturalDuration: 10 },
    flock: definition,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    is3D: true,
  };
}

const track: TimelineTrack = {
  id: 'video-1',
  name: 'Video 1',
  type: 'video',
  height: 60,
  muted: false,
  visible: true,
  solo: false,
};

describe('flock node graph projection', () => {
  it('adds a Flock view for flock clips and none for other clips', () => {
    const clip = createFlockClip();
    const document = buildClipNodeGraphDocument(clip, track);
    expect(document.views.map((view) => view.theme)).toEqual(['general', 'flock', 'color']);
    expect(getNodeGraphView(document, 'flock').id).toBe(getClipFlockGraphId(clip.id));

    const videoClip: TimelineClip = { ...clip, id: 'clip-video', source: { type: 'video' }, flock: undefined };
    expect(buildClipNodeGraphDocument(videoClip, track).views.map((view) => view.theme)).not.toContain('flock');
    expect(buildClipFlockNodeGraph(videoClip)).toBeNull();
  });

  it('points the general source node at the flock subgraph', () => {
    const clip = createFlockClip();
    const general = getNodeGraphView(buildClipNodeGraphDocument(clip, track), 'general');
    const source = general.nodes.find((node) => node.id === 'source');
    expect(source?.subgraphId).toBe(getClipFlockGraphId(clip.id));
    expect(general.nodes.some((node) => node.binding?.kind === 'flock-node')).toBe(false);
  });

  it('mirrors definition nodes, layout and edges without copying into clip.nodeGraph', () => {
    const clip = createFlockClip();
    const definition = clip.flock!;
    const graph = buildClipFlockNodeGraph(clip)!;

    expect(graph.nodes.map((node) => node.id)).toEqual(definition.nodes.map((node) => node.id));
    expect(graph.edges.map((edge) => edge.id)).toEqual(definition.edges.map((edge) => edge.id));
    const emitter = definition.nodes.find((node) => node.operator === 'flock.emitter')!;
    const projected = graph.nodes.find((node) => node.id === emitter.id)!;
    expect(projected.layout).toEqual(definition.layout[emitter.id]);
    expect(projected.binding).toEqual({ kind: 'flock-node', nodeId: emitter.id, operator: 'flock.emitter' });
    expect(projected.domain).toBe('flock');
    expect(projected.params?.['size.x']).toBe(70);
    expect(clip.nodeGraph).toBeUndefined();
  });

  it('keeps flock port semantics distinct even when signal kinds collide', () => {
    const graph = buildClipFlockNodeGraph(createFlockClip())!;
    const simulation = graph.nodes.find((node) => node.params?.operator === 'flock.simulation')!;
    const spawn = simulation.inputs.find((port) => port.id === 'spawn')!;
    const behavior = simulation.inputs.find((port) => port.id === 'behavior')!;
    expect(spawn.type).toBe(behavior.type);
    expect(getFlockPortType(spawn)).toBe('spawn');
    expect(spawn.metadata?.required).toBe(true);
    expect(getNodeGraphPortCompatibilityKey(spawn)).not.toBe(getNodeGraphPortCompatibilityKey(behavior));

    const spawnEdge = graph.edges.find((edge) => edge.toNodeId === simulation.id && edge.toPortId === 'spawn')!;
    expect(spawnEdge.type).toBe(spawn.type);
    expect(getNodeGraphPortCompatibilityKey({ type: 'texture' })).toBe('texture');
  });

  it('projects group instances with ports from their group definition', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const turbulence = definition.nodes.find((node) => node.operator === 'flock.turbulence')!;
    const grouped = createFlockGroupFromNodes(definition, [turbulence.id], 'Swirl');
    if (!grouped.ok) throw new Error(grouped.message);

    const graph = buildClipFlockNodeGraph(createFlockClip(grouped.definition))!;
    const groupNode = graph.nodes.find((node) => node.id === grouped.groupNodeId)!;
    expect(groupNode.runtime).toBe('subgraph');
    expect(groupNode.label).toBe('Swirl');
    expect(groupNode.outputs.map((port) => getFlockPortType(port))).toEqual(['behavior']);
    expect(groupNode.subgraphId).toContain(grouped.groupId);
    // A bypassed group instance mutes all of its outputs.
    expect(groupNode.params?.bypassable).toBe(true);
  });

  it('reports node-scoped diagnostics counts for invalid drafts', () => {
    const definition = createFlockPresetDefinition('free-swarm');
    const spawnEdge = definition.edges.find((edge) => edge.to.port === 'spawn')!;
    const draft = disconnectFlockEdge(definition, spawnEdge.id);
    if (!draft.ok) throw new Error(draft.message);
    const graph = buildClipFlockNodeGraph(createFlockClip(draft.definition))!;
    const simulation = graph.nodes.find((node) => node.params?.operator === 'flock.simulation')!;
    expect(simulation.params?.flockErrors).toBeGreaterThanOrEqual(1);
  });
});
