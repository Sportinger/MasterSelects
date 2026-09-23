import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { renderHostPort } from '../render/renderHostPort';
import { getCachedTimelineLoudnessEnvelope, loadTimelineLoudnessEnvelope } from '../audio/timelineLoudnessEnvelopeCache';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { TimelineClip, SerializableClip } from '../../types/timeline';
import type { AudioParameterContext, AudioParameterSource } from './audioParameterContext';

const pending = new Map<string, Promise<unknown>>();
const unavailable = new Set<string>();
type AudioClip = TimelineClip | SerializableClip;
function sourceMediaId(clip: AudioClip | undefined) {
  return clip && ('source' in clip ? clip.source?.mediaFileId ?? clip.mediaFileId : clip.mediaFileId);
}
function availableClips(): AudioClip[] {
  const clips: AudioClip[] = [];
  const collect = (items: readonly AudioClip[]) => { for (const clip of items) {
    clips.push(clip); if ('nestedClips' in clip && clip.nestedClips) collect(clip.nestedClips);
  } };
  collect(useTimelineStore.getState().clips);
  for (const composition of useMediaStore.getState().compositions) collect(composition.timelineData?.clips ?? []);
  return clips;
}
function load(ref: string) {
  let request = pending.get(ref);
  if (!request) {
    request = loadTimelineLoudnessEnvelope(ref).then(result => {
      if (!result) unavailable.add(ref);
      return result;
    }, error => { unavailable.add(ref); throw error; }).finally(() => { pending.delete(ref); renderHostPort.requestRender(); });
    pending.set(ref, request);
  }
  return request;
}

/** IDs remain authored; runtime values are read at the requested render time. */
export function liveAudioParameterContext(graph: EffectOperatorGraph, loadMissing = true): AudioParameterContext {
  const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
  const clips = availableClips();
  const result = new Map<string, AudioParameterSource>();
  for (const node of graph.nodes.filter(node => node.operator === 'control.audio-envelope')) {
    const id = String(node.constants?.audioClipId ?? ''), clip = clips.find(clip => clip.id === id);
    const mediaId = sourceMediaId(clip);
    const file = media.files.find(file => file.id === mediaId);
    const artifactId = file?.audioAnalysisRefs?.loudnessEnvelopeId;
    if (!clip || !mediaId || !artifactId) continue;
    const envelope = getCachedTimelineLoudnessEnvelope(artifactId);
    if (!envelope) { if (loadMissing && !unavailable.has(artifactId)) void load(artifactId).catch(() => undefined); continue; }
    result.set(id, { clip: { startTime: clip.startTime, duration: clip.duration, inPoint: clip.inPoint,
      outPoint: clip.outPoint, speed: clip.speed, videoInspectorSections: clip.videoInspectorSections,
      transitionSourceMap: clip.transitionSourceMap }, mediaId, artifactId,
      keyframes: timeline.clipKeyframes.get(id) ?? (clip as TimelineClip & { keyframes?: AudioParameterSource['keyframes'] }).keyframes ?? [], envelope });
  }
  return result;
}

export async function prepareAudioParameterGraphs(graphs: readonly EffectOperatorGraph[]): Promise<void> {
  const files = useMediaStore.getState().files, clips = availableClips();
  const refs = new Set<string>();
  for (const graph of graphs) for (const node of graph.nodes) {
    if (node.operator !== 'control.audio-envelope') continue;
    const clip = clips.find(clip => clip.id === node.constants?.audioClipId);
    const file = files.find(file => file.id === sourceMediaId(clip));
    if (file?.audioAnalysisRefs?.loudnessEnvelopeId) refs.add(file.audioAnalysisRefs.loudnessEnvelopeId);
  }
  await Promise.all([...refs].map(load));
}
