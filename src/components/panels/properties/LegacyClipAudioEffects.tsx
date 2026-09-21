import { useTimelineStore } from '../../../stores/timeline';
import { normalizeLegacyClipAudioEffects } from '../../../engine/audio/graphRender/effectStackNormalization';
import { createEffectProperty } from '../../../types/animationProperties';
import { AudioEffectStackControl } from './AudioEffectStackControl';

/** Keep old clip.effects owners editable without copying/migrating them into the registry stack. */
export function LegacyClipAudioEffects({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const playhead = useTimelineStore(state => state.playheadPosition);
  const { getInterpolatedEffects, setPropertyValue, updateClipEffect, setClipEffectEnabled,
    removeClipEffect, reorderClipEffect } = useTimelineStore.getState();
  if (!clip) return null;
  const registryIds = new Set(clip.audioState?.effectStack?.map(effect => effect.id));
  const effects = normalizeLegacyClipAudioEffects(getInterpolatedEffects(clipId, playhead - clip.startTime), registryIds)
    .filter(effect => !['audio-volume', 'audio-eq'].includes(effect.descriptorId));
  if (!effects.length) return null;
  return <AudioEffectStackControl title="Additional clip audio effects" effects={effects} keyframeClipId={clipId}
    onUpdateEffect={(effect, param, value) => {
      if (typeof value === 'number') setPropertyValue(clipId, createEffectProperty(effect.id, param), value);
      else updateClipEffect(clipId, effect.id, { [param]: value });
    }}
    onSetEffectEnabled={(id, enabled) => setClipEffectEnabled(clipId, id, enabled)}
    onRemoveEffect={id => removeClipEffect(clipId, id)}
    onReorderEffect={(id, index) => {
      const targetId = effects[index]?.id;
      const current = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
      const targetIndex = current?.effects.findIndex(effect => effect.id === targetId) ?? -1;
      if (targetIndex >= 0) reorderClipEffect(clipId, id, targetIndex);
    }} />;
}
