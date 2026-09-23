import { expect, it } from 'vitest';
import { evaluateAudioParameter, freezeAudioParameterContext, type AudioParameterContext, type AudioParameterSource } from '../../src/services/parameterSources/audioParameterContext';
import { createParameterSourceEvaluator } from '../../src/services/parameterSources/parameterSourceEvaluation';
import { createControlNode } from '../../src/services/parameterSources/controlOperators';
import type { ParameterSourceClip } from '../../src/services/parameterSources/parameterSourceTargets';

function context(): Map<string, AudioParameterSource> {
  return new Map([['audio', { clip: { startTime: 10, duration: 2, inPoint: 1, outPoint: 3, speed: 1 },
    mediaId: 'media', artifactId: 'analysis', keyframes: [], envelope: { sampleRate: 100, duration: 4,
      curves: [{ metric: 'rms-dbfs', hopDuration: 1, windowDuration: 1, pointCount: 4, values: new Float32Array([-60, -40, -20, 0]) }] } }]]);
}
const options = { metric: 'rms-dbfs', interpolation: 'linear', floorDb: -60, ceilingDb: 0 } as const;
it('maps placement, trim, reverse and explicit source seconds deterministically', () => {
  const sources = context();
  expect(evaluateAudioParameter(sources, 'audio', 10.5, 'timeline', options)).toBeCloseTo(.5);
  sources.get('audio')!.clip.speed = -1;
  expect(evaluateAudioParameter(sources, 'audio', 10.5, 'timeline', options)).toBeCloseTo(5 / 6);
  expect(evaluateAudioParameter(sources, 'audio', 1.5, 'source', options)).toBeCloseTo(.5);
  for (const time of [9, 12]) expect(evaluateAudioParameter(sources, 'audio', time, 'timeline', options)).toBe(0);
  expect(() => evaluateAudioParameter(sources, 'deleted', 10, 'timeline', options)).toThrow('unavailable');
});
function fixture(): ParameterSourceClip {
  const node = createControlNode('control.audio-envelope', 'audio-node');
  node.constants!.audioClipId = 'audio';
  return { startTime: 10, effects: [{ id: 'scan', type: 'slit-scan', name: 'Slit Scan', enabled: true, params: { mapAmount: .1 } }],
    nodeGraph: { version: 1, nodes: [], parameterSources: { version: 1, clipTimeOffset: 0,
      graph: { version: 1, nodes: [node], edges: [], layout: {} },
      targets: { 'effect.scan.mapAmount': { source: { nodeId: node.id, portId: 'value' } } } } } };
}
it('evaluates the actual control node and freezes analysis plus source placement for export', () => {
  const sources = context(), clip = fixture(), graph = clip.nodeGraph!.parameterSources!.graph;
  const sample = (audio: AudioParameterContext) => createParameterSourceEvaluator(clip, [], .5, 10.5, audio).resolve('effect.scan.mapAmount').value;
  expect(sample(sources)).toBeCloseTo(.5);
  freezeAudioParameterContext(graph, sources);
  sources.get('audio')!.envelope.curves[0].values.fill(0);
  sources.get('audio')!.clip.startTime = 20;
  expect(sample(sources)).toBeCloseTo(.5);
  clip.nodeGraph!.parameterSources!.targets['effect.scan.mapAmount'].enabled = false;
  expect(sample(sources)).toBe(.1);
});
