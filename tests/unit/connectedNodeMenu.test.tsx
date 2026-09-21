import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { connectionNodeCatalog } from '../../src/services/nodeGraph/connectionNodeCatalog';
import { addConnectedNode } from '../../src/services/nodeGraph/addConnectedNode';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { readAudioOperatorGraph } from '../../src/services/operators/audioOperatorGraph';
import { ConnectedNodeMenu } from '../../src/components/panels/nodes/workspace/ConnectedNodeMenu';
import type { NodeConnectionDrop, NodeGraphNode } from '../../src/types/nodeGraph';
import { createDefaultColorCorrectionState, getActiveColorVersion } from '../../src/types/colorCorrection';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); useTimelineStore.setState(initial); vi.restoreAllMocks(); });
function fixture(audio = false) {
  const clip = createMockClip({ id: 'test-clip', source: { type: audio ? 'audio' : 'video' },
    effects: audio ? [] : [{ id: 'invert', name: 'Invert', type: 'invert', enabled: true, params: {} }],
    ...(audio ? { audioState: { effectStack: [{ id: 'audio-owner', descriptorId: 'audio-math', enabled: true, params: { operatorGraph: '' } }] } } : {}) });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, type: audio ? 'audio' : 'video' })], isExporting: false });
  const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true);
  return { clip, graph };
}
function drop(node: NodeGraphNode, direction: 'input' | 'output' = 'output', portId?: string): NodeConnectionDrop {
  return { nodeId: node.id, portId: portId ?? (direction === 'output' ? node.outputs : node.inputs)[0].id, direction,
    x: 140, y: 160, layout: { x: 500, y: 400 } };
}
describe('compatible node creation', () => {
  it('chooses an executable image variant and connects it in the existing effect', () => {
    const { clip, graph } = fixture(), source = graph.nodes.find(node => node.operatorId === 'image.frame')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(source), [clip]);
    const option = catalog.options.find(option => option.operatorId === 'math.multiply.image-scalar')!;
    expect(option).toBeDefined(); expect(option.operatorId).not.toContain('audio');
    const id = addConnectedNode(catalog, option, clip.id).split('/').at(-1)!;
    const saved = effectOperatorGraph(useTimelineStore.getState().clips[0].effects[0]);
    expect(saved.nodes.find(node => node.id === id)?.operator).toBe(option.operatorId);
    expect(saved.edges.some(edge => edge.to === id && edge.input === option.port.id)).toBe(true);
    expect(saved.edges.filter(edge => edge.to === id)).toHaveLength(1);
  });
  it('keeps scalar sources scalar and offers raw sample math at an audio port', () => {
    const { clip, graph } = fixture(true), source = graph.nodes.find(node => node.operatorId === 'audio.input')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(source), [clip]);
    const option = catalog.options.find(option => option.label === 'Multiply' && option.port.label === 'A')!;
    expect(option.operatorId).toBe('math.multiply.audio-scalar');
    const id = addConnectedNode(catalog, option, clip.id).split('/').at(-1)!;
    const saved = readAudioOperatorGraph(useTimelineStore.getState().clips[0].audioState!.effectStack![0].params.operatorGraph);
    expect(saved.nodes.find(node => node.id === id)?.operator).toBe('math.multiply.audio-scalar');
    expect(saved.edges.filter(edge => edge.to === id)).toEqual([expect.objectContaining({ from: 'input', output: 'audio', input: 'a' })]);
    expect(catalog.options.some(option => option.candidateId.startsWith('image.'))).toBe(false);
  });
  it('only replaces an occupied input after a producer was selected', () => {
    const { clip, graph } = fixture(true), target = graph.nodes.find(node => node.operatorId === 'math.multiply.audio-scalar')!;
    const before = useTimelineStore.getState().clips;
    const catalog = connectionNodeCatalog(clip, graph, drop(target, 'input', 'b'), [clip]);
    expect(useTimelineStore.getState().clips).toBe(before);
    const value = catalog.options.find(option => option.candidateId === 'values.number')!;
    const id = addConnectedNode(catalog, value, clip.id).split('/').at(-1)!;
    const saved = readAudioOperatorGraph(useTimelineStore.getState().clips[0].audioState!.effectStack![0].params.operatorGraph);
    expect(saved.edges.filter(edge => edge.to === 'multiply' && edge.input === 'b')).toEqual([expect.objectContaining({ from: id })]);
    expect(saved.nodes.some(node => node.id === 'gain')).toBe(true);
  });
  it('rejects stale/incompatible selections atomically, and obeys the owner lock', () => {
    const { clip, graph } = fixture(true), source = graph.nodes.find(node => node.operatorId === 'audio.input')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(source), [clip]), option = catalog.options[0];
    const before = useTimelineStore.getState().clips;
    expect(() => addConnectedNode(catalog, { ...option, operatorId: 'image.frame' }, clip.id)).toThrow();
    expect(useTimelineStore.getState().clips).toBe(before);
    useTimelineStore.setState({ tracks: [createMockTrack({ id: clip.trackId, locked: true })] });
    expect(() => addConnectedNode(catalog, option, clip.id)).toThrow('locked');
    expect(useTimelineStore.getState().clips).toBe(before);
  });
  it('offers visual effects on root image ports and creates their connected instance', () => {
    const { clip, graph } = fixture(), source = graph.nodes.find(node => node.id === 'source')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(source, 'output', 'texture'), [clip]);
    const option = catalog.options.find(option => option.candidateId === 'effect:blur') ?? catalog.options.find(option => option.candidateId === 'effect:invert')!;
    expect(option).toBeDefined(); expect(catalog.options.every(option => !option.candidateId.startsWith('audio:'))).toBe(true);
    const id = addConnectedNode(catalog, option, clip.id);
    const current = useTimelineStore.getState().clips[0];
    const root = buildClipNodeGraphDocument(current).graphs[0];
    expect(current.effects).toHaveLength(2);
    expect(root.edges.some(edge => edge.fromNodeId === 'source' && edge.toNodeId === id)).toBe(true);
  });
  it('includes key and image Color nodes using their actual port contracts', () => {
    const { clip } = fixture(); clip.colorCorrection = createDefaultColorCorrectionState();
    useTimelineStore.setState({ clips: [clip] });
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], [], undefined, true);
    const node = graph.nodes.find(node => node.binding?.kind === 'color-node' && node.binding.nodeType === 'primary')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(node, 'output', 'key-out'), [clip]);
    const option = catalog.options.find(option => option.candidateId === 'key-mixer')!;
    expect(option).toBeDefined(); expect(catalog.options.some(option => option.candidateId === 'layer-mixer')).toBe(false);
    addConnectedNode(catalog, option, clip.id);
    expect(getActiveColorVersion(useTimelineStore.getState().clips[0].colorCorrection!)?.nodes.some(node => node.type === 'key-mixer')).toBe(true);
  });
  it('inserts an audio effect at the chosen source on the linked audio owner', () => {
    const { clip } = fixture();
    const audio = createMockClip({ id: 'linked-audio', linkedClipId: clip.id, source: { type: 'audio' },
      audioState: { effectStack: [{ id: 'existing', descriptorId: 'audio-channel-swap', enabled: true, params: {} }] } });
    useTimelineStore.setState({ clips: [clip, audio] });
    const document = buildClipNodeGraphDocument(clip, undefined, { linkedClip: audio });
    const graph = buildUnifiedClipGraph(document, clip, [clip, audio], []);
    const catalog = connectionNodeCatalog(clip, graph, drop(graph.nodes.find(node => node.id === 'source')!, 'output', 'audio'), [clip, audio]);
    expect(catalog.ownerId).toBe(audio.id);
    const option = catalog.options.find(option => option.candidateId === 'audio:audio-channel-swap')!;
    const id = addConnectedNode(catalog, option, clip.id);
    const [videoNow, audioNow] = useTimelineStore.getState().clips;
    expect(audioNow.audioState!.effectStack![0].id).toBe(id.slice('audio-effect-'.length));
    const root = buildClipNodeGraphDocument(videoNow, undefined, { linkedClip: audioNow }).graphs[0];
    expect(root.edges.some(edge => edge.fromNodeId === 'source' && edge.fromPortId === 'audio' && edge.toNodeId === id)).toBe(true);
  });
  it('rejects a root menu selection after its originating effect was removed', () => {
    const { clip } = fixture();
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(clip), clip, [clip], []);
    const node = graph.nodes.find(node => node.id === 'effect-invert')!;
    const catalog = connectionNodeCatalog(clip, graph, drop(node), [clip]);
    useTimelineStore.setState({ clips: [{ ...clip, effects: [] }] });
    const before = useTimelineStore.getState().clips;
    expect(() => addConnectedNode(catalog, catalog.options[0], clip.id)).toThrow();
    expect(useTimelineStore.getState().clips).toBe(before);
  });
  it('supports searchable, keyboard-selectable choices and Escape without editing', () => {
    const { clip, graph } = fixture(true), node = graph.nodes.find(node => node.operatorId === 'audio.input')!;
    const close = vi.fn(), added = vi.fn();
    render(<ConnectedNodeMenu clip={clip} graph={graph} drop={drop(node)} onClose={close} onAdded={added} />);
    const input = screen.getByRole('textbox', { name: 'Search compatible nodes' });
    expect(input).toHaveFocus(); fireEvent.change(input, { target: { value: 'Multiply' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Multiply');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce();
    expect(added).not.toHaveBeenCalled(); expect(useTimelineStore.getState().clips[0]).toBe(clip);
  });
});
