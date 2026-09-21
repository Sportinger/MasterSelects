import { afterEach, describe, expect, it } from 'vitest';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import { buildClipNodeGraphDocument, createClipNodeGraphState } from '../../src/services/nodeGraph';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';
import { captureSnapshot, initHistoryStoreRefs, useHistoryStore } from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useDockStore } from '../../src/stores/dockStore';

const initial = useTimelineStore.getState();
afterEach(() => { useTimelineStore.setState(initial); useHistoryStore.getState().clearHistory(); });
describe('deleting native audio nodes', () => {
  it.each(['audio-math', 'de-esser'])('removes %s through the linked video graph and restores it with undo', descriptorId => {
    const video = createMockClip({ id: 'video', source: { type: 'video' }, linkedClipId: 'audio' });
    const audio = createMockClip({ id: 'audio', source: { type: 'audio' }, linkedClipId: 'video', trackId: 'audio-track',
      audioState: { effectStack: [{ id: 'fx', descriptorId, enabled: true, params: {} }] } });
    video.nodeGraph = createClipNodeGraphState(video, undefined, { linkedClip: audio });
    useTimelineStore.setState({ clips: [video, audio], tracks: [createMockTrack({ id: video.trackId }), createMockTrack({ id: audio.trackId, type: 'audio' })], isExporting: false });
    initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
      media: { getState: useMediaStore.getState, setState: useMediaStore.setState }, dock: { getState: useDockStore.getState, setState: useDockStore.setState } });
    useHistoryStore.getState().clearHistory(); captureSnapshot('Before audio node deletion');
    useTimelineStore.getState().removeClipNodeGraphNode(video.id, 'audio-effect-fx');
    const saved = useTimelineStore.getState().clips;
    expect(saved.find(clip => clip.id === audio.id)!.audioState!.effectStack).toEqual([]);
    const graph = buildUnifiedClipGraph(buildClipNodeGraphDocument(saved[0], undefined, { linkedClip: saved[1] }), saved[0], saved);
    expect(graph.nodes.some(node => node.id === 'audio-effect-fx')).toBe(false);
    expect(graph.edges.some(edge => edge.fromNodeId === 'audio-effect-fx' || edge.toNodeId === 'audio-effect-fx')).toBe(false);
    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.find(clip => clip.id === audio.id)!.audioState!.effectStack).toEqual(audio.audioState!.effectStack);
  });
  it('preserves audio nodes on a locked audio track', () => {
    const clip = createMockClip({ source: { type: 'audio' }, audioState: { effectStack: [{ id: 'fx', descriptorId: 'audio-math', enabled: true, params: {} }] } });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId, locked: true })], isExporting: false });
    useTimelineStore.getState().removeClipNodeGraphNode(clip.id, 'audio-effect-fx');
    expect(useTimelineStore.getState().clips[0].audioState).toEqual(clip.audioState);
  });
});
