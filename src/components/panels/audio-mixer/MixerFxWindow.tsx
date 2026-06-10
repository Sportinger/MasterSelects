import { useTimelineStore } from '../../../stores/timeline';
import type { MasterAudioState } from '../../../types/audio';
import type { TimelineTrack } from '../../../types/timeline';
import { AudioEffectStackControl } from '../properties/AudioEffectStackControl';
import type { FxWindowTarget } from './audioMixerTypes';
import { getTrackAudioState } from './audioMixerMath';
import { getEffectName } from './audioMixerEffects';
import { MIXER_METER_DYNAMICS_FEATURES, useMixerRuntimeAudioMeter } from './MixerMeter';

export function MixerFxWindow({
  target,
  tracks,
  masterAudio,
  onClose,
}: {
  target: FxWindowTarget | null;
  tracks: readonly TimelineTrack[];
  masterAudio: MasterAudioState;
  onClose: () => void;
}) {
  const runtimeMeter = useMixerRuntimeAudioMeter(
    target?.scope,
    target?.scope === 'track' ? target.trackId : undefined,
    MIXER_METER_DYNAMICS_FEATURES,
  );
  const runtimeDynamics = runtimeMeter?.dynamics;
  if (!target) return null;

  const track = target.scope === 'track'
    ? tracks.find(item => item.id === target.trackId)
    : undefined;
  const audioState = track ? getTrackAudioState(track) : undefined;
  const effects = target.scope === 'track'
    ? audioState?.effectStack ?? []
    : masterAudio.effectStack ?? [];
  const selectedEffect = target.effectId
    ? effects.find(effect => effect.id === target.effectId)
    : undefined;
  const title = target.scope === 'track'
    ? `${track?.name ?? 'Track'} FX`
    : 'Master FX';
  if (target.scope === 'track' && !track) return null;

  return (
    <div className="audio-mixer-floating-fx" role="dialog" aria-label={title}>
      <div className="audio-mixer-floating-fx-header">
        <div>
          <strong>{title}</strong>
          <span>{selectedEffect ? getEffectName(selectedEffect) : `${effects.length} inserts`}</span>
        </div>
        <button type="button" onClick={onClose} title="Close FX window">X</button>
      </div>

      <AudioEffectStackControl
        title={title}
        className="audio-effect-stack-compact audio-mixer-fx-stack floating"
        effects={effects}
        runtimeDynamics={runtimeDynamics}
        runtimeAnalyzerScope={target.scope}
        runtimeAnalyzerTrackId={target.scope === 'track' ? target.trackId : undefined}
        emptyLabel={target.scope === 'track' ? 'No track FX' : 'No master FX'}
        onAddEffect={(descriptorId) => {
          if (target.scope === 'track' && track) {
            useTimelineStore.getState().addTrackAudioEffectInstance(track.id, descriptorId);
          } else {
            useTimelineStore.getState().addMasterAudioEffectInstance(descriptorId);
          }
        }}
        onUpdateEffect={(effect, paramName, value) => {
          if (target.scope === 'track' && track) {
            useTimelineStore.getState().updateTrackAudioEffectInstance(track.id, effect.id, { [paramName]: value });
          } else {
            useTimelineStore.getState().updateMasterAudioEffectInstance(effect.id, { [paramName]: value });
          }
        }}
        onSetEffectEnabled={(effectId, enabled) => {
          if (target.scope === 'track' && track) {
            useTimelineStore.getState().setTrackAudioEffectInstanceEnabled(track.id, effectId, enabled);
          } else {
            useTimelineStore.getState().setMasterAudioEffectInstanceEnabled(effectId, enabled);
          }
        }}
        onRemoveEffect={(effectId) => {
          if (target.scope === 'track' && track) {
            useTimelineStore.getState().removeTrackAudioEffectInstance(track.id, effectId);
          } else {
            useTimelineStore.getState().removeMasterAudioEffectInstance(effectId);
          }
        }}
        onReorderEffect={(effectId, newIndex) => {
          if (target.scope === 'track' && track) {
            useTimelineStore.getState().reorderTrackAudioEffectInstance(track.id, effectId, newIndex);
          } else {
            useTimelineStore.getState().reorderMasterAudioEffectInstance(effectId, newIndex);
          }
        }}
      />
    </div>
  );
}
