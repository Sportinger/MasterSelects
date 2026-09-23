import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { TimelineLoudnessEnvelope } from '../audio/timelineLoudnessEnvelopeCache';
import { sampleAudioEnvelope, type AudioEnvelopeSampling } from './audioEnvelopeSampling';
import { calculateSourceTime, getSpeedAtTime } from '../../utils/speedIntegration';
import { resolveTransitionSourceMapTime } from '../timeline/transitionSourceMap';
import { isVideoInspectorSectionEnabled } from '../videoInspector/sectionBypass';
import type { ParameterSources } from '../../types/parameterSources';

export interface AudioParameterSource {
  clip: Pick<TimelineClip, 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'speed' | 'videoInspectorSections' | 'transitionSourceMap'>;
  mediaId: string;
  artifactId: string;
  keyframes: Keyframe[];
  envelope: TimelineLoudnessEnvelope;
}
export type AudioParameterContext = ReadonlyMap<string, AudioParameterSource>;
const snapshots = new WeakMap<EffectOperatorGraph, AudioParameterContext>();

/** Export contexts are runtime-owned: never serialized into project graphs. */
export function freezeAudioParameterContext(graph: EffectOperatorGraph, context: AudioParameterContext): void {
  snapshots.set(graph, structuredClone(context));
}
export function frozenAudioParameterContext(graph: EffectOperatorGraph): AudioParameterContext | undefined {
  return snapshots.get(graph);
}
export function cloneAudioParameterSources(state: ParameterSources | undefined): ParameterSources | undefined {
  if (!state) return undefined;
  const copy = structuredClone(state), context = snapshots.get(state.graph);
  if (context) snapshots.set(copy.graph, context);
  return copy;
}

export function evaluateAudioParameter(context: AudioParameterContext, clipId: string, time: number,
  basis: 'timeline' | 'source', options: Omit<AudioEnvelopeSampling, 'sourceTime'>): number {
  const source = context.get(clipId);
  if (!source) throw new Error('Audio source or loudness analysis is unavailable.');
  if (!Number.isFinite(time)) throw new Error('Audio source time must be finite.');
  if (basis !== 'timeline' && basis !== 'source') throw new Error('Unknown audio time basis.');
  const { clip } = source;
  let sourceTime = time;
  if (basis === 'timeline') {
    const local = time - clip.startTime;
    if (local < 0 || local >= clip.duration) return 0;
    const mapped = resolveTransitionSourceMapTime(clip.transitionSourceMap, local);
    if (mapped) sourceTime = mapped.sourceTime;
    else {
      const enabled = isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange');
      const keys = enabled ? source.keyframes : [], speed = enabled ? clip.speed ?? 1 : 1;
      const start = getSpeedAtTime(keys, 0, speed) < 0 ? clip.outPoint : clip.inPoint;
      sourceTime = Math.max(clip.inPoint, Math.min(clip.outPoint, start + calculateSourceTime(keys, local, speed)));
    }
    // Reverse playback begins at the exclusive out point: use its last sample.
    if (sourceTime === source.envelope.duration) sourceTime = Math.max(0, sourceTime - 1 / source.envelope.sampleRate);
  }
  return sampleAudioEnvelope(source.envelope, { ...options, sourceTime });
}
