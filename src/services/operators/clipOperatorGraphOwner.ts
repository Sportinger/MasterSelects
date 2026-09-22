import { useTimelineStore } from '../../stores/timeline';
import { projectSceneGraphClip } from '../nodeGraph/sceneGraphOutputs';
import type { Effect } from '../../types/effects';
import type { TimelineClip } from '../../types/timeline';

/** A shared editor view of an effect owner. The native audio instance remains
 * authoritative; it is never copied into the visual effect stack. */
export function resolveClipOperatorOwner(clip: TimelineClip | undefined, effectId: string, clips: readonly TimelineClip[] = []): TimelineClip | undefined {
  if (clip?.sceneGraphOutput) {
    const documents = useTimelineStore.getState().sharedSceneGraphs;
    const document = documents?.[clip.sceneGraphOutput.graphId];
    if (document?.effect.id === effectId) clip = clips.find(c => c.id === document.sourceClipId) ?? clip;
    clip = projectSceneGraphClip(clip, documents);
  }
  const owns = (candidate: TimelineClip) => candidate.effects.some(effect => effect.id === effectId)
    || candidate.audioState?.effectStack?.some(effect => effect.id === effectId && effect.descriptorId === 'audio-math');
  if (!clip || owns(clip)) return clip;
  return clips.find(candidate => (candidate.id === clip.linkedClipId || candidate.linkedClipId === clip.id) && owns(candidate));
}

export function findClipOperatorEffect(clip: TimelineClip | undefined, effectId: string, clips: readonly TimelineClip[] = []): Effect | undefined {
  clip = resolveClipOperatorOwner(clip, effectId, clips);
  const visual = clip?.effects.find(effect => effect.id === effectId);
  if (visual) return visual;
  const audio = clip?.audioState?.effectStack?.find(effect => effect.id === effectId && effect.descriptorId === 'audio-math');
  return audio ? { id: audio.id, name: 'Audio Math Graph', type: 'audio-math', enabled: audio.enabled !== false,
    params: audio.params ?? {} } : undefined;
}
