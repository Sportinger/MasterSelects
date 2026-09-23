import { afterEach, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { createMockClip } from '../helpers/mockData';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import { createParameterSourceEvaluator } from '../../src/services/parameterSources/parameterSourceEvaluation';
import { captureExportParameterState } from '../../src/engine/export/frameExporter/parameterSourceSnapshot';
import { liveAudioParameterContext } from '../../src/services/parameterSources/audioParameterRuntime';
import { frozenAudioParameterContext } from '../../src/services/parameterSources/audioParameterContext';
import { cloneClipNodeGraph } from '../../src/services/nodeGraph/clipGraphProjectionState';
import { primeTimelineLoudnessEnvelopeCache, evictTimelineLoudnessEnvelopeRefs } from '../../src/services/audio/timelineLoudnessEnvelopeCache';

const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
afterEach(() => { useTimelineStore.setState(timeline); vi.mocked(useMediaStore.getState).mockReturnValue(media); evictTimelineLoudnessEnvelopeRefs(['audio-export-test']); });

it('exports frozen audio analysis and placement even after media, clip and cache changes', async () => {
  const node = createControlNode('control.audio-envelope', 'level'); node.constants!.audioClipId = 'audio';
  const target = createMockClip({ id: 'target', startTime: 10, effects: [
    { id: 'scan', name: 'Slit Scan', type: 'slit-scan', enabled: true, params: { mapAmount: .1 } }],
    nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes: [node], edges: [], layout: {} },
      targets: { 'effect.scan.mapAmount': { source: { nodeId: 'level', portId: 'value' } } } } } });
  const audio = createMockClip({ id: 'audio', startTime: 10, duration: 2, inPoint: 0, outPoint: 2,
    mediaFileId: 'audio-media', source: null });
  const values = new Float32Array([-60, 0]);
  useTimelineStore.setState({ clips: [target, audio], clipKeyframes: new Map() });
  vi.mocked(useMediaStore.getState).mockReturnValue({ ...media, files: [{ id: 'audio-media', audioAnalysisRefs: { loudnessEnvelopeId: 'audio-export-test' } } as MediaFile], compositions: [] });
  primeTimelineLoudnessEnvelopeCache(['audio-export-test'], { sampleRate: 100, duration: 2,
    curves: [{ metric: 'rms-dbfs', windowDuration: 1, hopDuration: 1, pointCount: 2, values }] });
  expect(useTimelineStore.getState().clips.find(clip => clip.id === 'audio')?.mediaFileId).toBe('audio-media');
  expect(useMediaStore.getState().files[0].audioAnalysisRefs?.loudnessEnvelopeId).toBe('audio-export-test');
  expect([...liveAudioParameterContext(target.nodeGraph!.parameterSources!.graph, false).keys()]).toEqual(['audio']);
  const snapshot = await captureExportParameterState();
  expect([...frozenAudioParameterContext(snapshot.timeline.clips[0].nodeGraph!.parameterSources!.graph)!.keys()]).toEqual(['audio']);
  values.fill(-60); evictTimelineLoudnessEnvelopeRefs(['audio-export-test']);
  useTimelineStore.setState({ clips: [] }); vi.mocked(useMediaStore.getState).mockReturnValue({ ...media, files: [], compositions: [] });
  const exported = snapshot.timeline.clips.find(clip => clip.id === 'target')!;
  const hydrated = { ...exported, nodeGraph: cloneClipNodeGraph(exported.nodeGraph) };
  expect(createParameterSourceEvaluator(exported, [], .5, 10.5).resolve('effect.scan.mapAmount').value).toBe(.5);
  expect(createParameterSourceEvaluator(hydrated, [], .5, 10.5).resolve('effect.scan.mapAmount').value).toBe(.5);
});
