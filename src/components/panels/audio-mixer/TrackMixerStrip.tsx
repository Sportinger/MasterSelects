import { memo, useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import {
  clearRuntimeTrackVolumeDbOverride,
  setRuntimeTrackVolumeDbOverride,
} from '../../../services/audio/runtimeAudioParamOverrides';
import type { TimelineTrack } from '../../../types/timeline';
import { AudioLevelMeter } from '../../timeline/components/AudioLevelMeter';
import { getAudioPanSliderStyle } from '../../timeline/utils/audioPanSliderStyle';
import { getTimelineTrackColor } from '../../timeline/trackColor';
import type { FxWindowTarget } from './audioMixerTypes';
import { formatDb, formatPan, getTrackAudioState } from './audioMixerMath';
import {
  getMixerRuntimeAudioMeterScope,
  MixerMeterReadout,
  MixerMeterScale,
  MIXER_METER_VISUAL_FEATURES,
} from './MixerMeter';
import { MixerRack, stopPropagation } from './MixerRack';
import { MixerVolumeFader } from './MixerVolumeFader';
import { useMixerFaderDraft } from './useMixerFaderDraft';

type MixerCssProperties = CSSProperties & {
  '--strip-color'?: string;
};

function TrackMixerStripComponent({
  track,
  index,
  focused,
  onFocus,
  onOpenFx,
  onOpenColorMenu,
}: {
  track: TimelineTrack;
  index: number;
  focused: boolean;
  onFocus: () => void;
  onOpenFx: (target: FxWindowTarget) => void;
  onOpenColorMenu: (event: ReactMouseEvent, trackId: string) => void;
}) {
  const meterScope = getMixerRuntimeAudioMeterScope('track', track.id);
  const audioState = getTrackAudioState(track);
  const effectiveMuted = audioState.muted;
  const effectiveSolo = audioState.solo;
  const effects = audioState.effectStack ?? [];
  const sends = audioState.sends ?? [];
  const stripStyle: MixerCssProperties = { '--strip-color': getTimelineTrackColor(track, index) };
  const commitTrackVolume = useCallback((volumeDb: number) => {
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, volumeDb);
  }, [track.id]);
  const previewTrackVolume = useCallback((volumeDb: number) => {
    setRuntimeTrackVolumeDbOverride(track.id, volumeDb);
  }, [track.id]);
  const clearTrackVolumePreview = useCallback(() => {
    clearRuntimeTrackVolumeDbOverride(track.id);
  }, [track.id]);
  const volumeDraft = useMixerFaderDraft(audioState.volumeDb, commitTrackVolume, {
    onPreviewValue: previewTrackVolume,
    onPreviewEnd: clearTrackVolumePreview,
  });
  const resetTrackPan = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioPan(track.id, 0);
  };
  const resetTrackVolume = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    volumeDraft.commitNow(0);
  };

  return (
    <section
      className={`audio-mixer-strip ${focused ? 'focused' : ''} ${effectiveMuted ? 'muted' : ''} ${audioState.recordArm ? 'armed' : ''}`}
      style={stripStyle}
      onClick={onFocus}
      onContextMenu={(event) => onOpenColorMenu(event, track.id)}
    >
      <div className="audio-mixer-strip-color" aria-hidden="true" />

      <div className="audio-mixer-strip-name">
        <strong title={track.name}>{track.name}</strong>
        <span>{track.type}</span>
      </div>

      <MixerRack
        effects={effects}
        sends={sends}
        onOpenEffect={(effectId) => {
          onFocus();
          onOpenFx({ scope: 'track', trackId: track.id, effectId });
        }}
        onAddSend={() => useTimelineStore.getState().addTrackAudioSend(track.id)}
        onToggleSend={(send) => useTimelineStore.getState().updateTrackAudioSend(track.id, send.id, {
          enabled: send.enabled === false,
        })}
      />

      <div className="audio-mixer-pan-row" onPointerDown={stopPropagation}>
        <span>L</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={audioState.pan}
          aria-label={`${track.name} pan`}
          title="Double-click to center pan"
          style={getAudioPanSliderStyle(audioState.pan)}
          onChange={(event) => useTimelineStore.getState().setTrackAudioPan(track.id, Number(event.currentTarget.value))}
          onDoubleClick={resetTrackPan}
        />
        <span>R</span>
      </div>

      <div className="audio-mixer-io-row" onPointerDown={stopPropagation}>
        <button
          type="button"
          className={audioState.recordArm ? 'record-active' : ''}
          onClick={() => useTimelineStore.getState().updateTrackAudioState(track.id, { recordArm: !audioState.recordArm })}
          title={audioState.recordArm ? 'Record armed' : 'Record arm'}
        >
          R
        </button>
        <button
          type="button"
          className={audioState.inputMonitor ? 'active' : ''}
          onClick={() => useTimelineStore.getState().updateTrackAudioState(track.id, { inputMonitor: !audioState.inputMonitor })}
          title={audioState.inputMonitor ? 'Input monitor on' : 'Input monitor off'}
        >
          In
        </button>
      </div>

      <div className="audio-mixer-mode-row" onPointerDown={stopPropagation}>
        <button
          type="button"
          className={effectiveMuted ? 'active' : ''}
          onClick={() => useTimelineStore.getState().setTrackMuted(track.id, !effectiveMuted)}
          title={effectiveMuted ? 'Unmute' : 'Mute'}
        >
          Mute
        </button>
        <button
          type="button"
          className={effectiveSolo ? 'active' : ''}
          onClick={() => useTimelineStore.getState().setTrackSolo(track.id, !effectiveSolo)}
          title={effectiveSolo ? 'Solo On' : 'Solo Off'}
        >
          Solo
        </button>
      </div>

      <div className="audio-mixer-value-row">
        <span>{formatDb(volumeDraft.value)}</span>
        <span>{formatPan(audioState.pan)}</span>
      </div>

      <div className="audio-mixer-fader-meter" onPointerDown={stopPropagation}>
        <MixerVolumeFader
          value={volumeDraft.value}
          ariaLabel={`${track.name} volume`}
          title="Double-click to reset volume to 0 dB"
          onBeginDrag={volumeDraft.beginDrag}
          onEndDrag={volumeDraft.endDrag}
          onChange={volumeDraft.setDraft}
          onDoubleClick={resetTrackVolume}
        />
        <AudioLevelMeter
          streamScope={meterScope}
          streamFeatures={MIXER_METER_VISUAL_FEATURES}
          label={`${track.name} level`}
          className="audio-mixer-meter"
          orientation="vertical"
          display="mono"
        />
        <MixerMeterScale />
      </div>

      <div className="audio-mixer-strip-output">
        <span>Post</span>
        <MixerMeterReadout scope="track" trackId={track.id} />
      </div>
    </section>
  );
}

export const TrackMixerStrip = memo(TrackMixerStripComponent, (prev, next) => (
  prev.track === next.track
  && prev.index === next.index
  && prev.focused === next.focused
  && prev.onOpenFx === next.onOpenFx
  && prev.onOpenColorMenu === next.onOpenColorMenu
));
