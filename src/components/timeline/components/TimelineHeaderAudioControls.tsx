import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback } from 'react';
import { MIDI_INSTRUMENT_OPTIONS, type MidiInstrument } from '../../../types/midiClip';
import type { TimelineHeaderProps } from '../types';
import { useTimelineStore } from '../../../stores/timeline';
import { AudioEffectStackControl } from '../../panels/properties/AudioEffectStackControl';
import { AudioLevelMeter } from './AudioLevelMeter';
import { TimelineHeaderAudioSends } from './TimelineHeaderAudioSends';
import { getAudioPanSliderStyle } from '../utils/audioPanSliderStyle';
import type { TimelineHeaderAudioPopoverState } from '../hooks/useTimelineHeaderAudioPopoverState';
import {
  AudioTrackTypeIcon,
  MidiTrackTypeIcon,
  TrackHeaderIcon,
} from './TimelineHeaderTrackIcons';

type HeaderTrack = TimelineHeaderProps['track'];
type AudioHeaderDensity = 'full' | 'compact' | 'condensed' | null;

export function TimelineHeaderAudioSummaryMeter() {
  return (
    <AudioLevelMeter
      streamScope={{ kind: 'master' }}
      streamFeatures={['level']}
      label="Summed audio level"
      className="audio-summary-background-meter"
      display="mono"
    />
  );
}

export function TimelineHeaderMixerTypeBadge({ isMidiTrack }: { isMidiTrack: boolean }) {
  return (
    <span
      className="track-type-icon-badge"
      title={isMidiTrack ? 'MIDI track' : 'Audio track'}
    >
      {isMidiTrack ? <MidiTrackTypeIcon /> : <AudioTrackTypeIcon />}
    </span>
  );
}

export function TimelineHeaderMixerMainControls({
  audioHeaderDensity,
  isMidiTrack,
  showAdvancedAudioControls,
  track,
  trackPan,
  trackPanLabel,
}: {
  audioHeaderDensity: AudioHeaderDensity;
  isMidiTrack: boolean;
  showAdvancedAudioControls: boolean;
  track: HeaderTrack;
  trackPan: number;
  trackPanLabel: string;
}) {
  const midiInstrumentKind = (isMidiTrack ? track.midiInstrument?.kind : undefined) ?? 'simple-synth';

  const handleTrackPanChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useTimelineStore.getState().setTrackAudioPan(track.id, Number(event.currentTarget.value));
  }, [track.id]);

  const handleTrackPanReset = useCallback((event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioPan(track.id, 0);
  }, [track.id]);

  return (
    <>
      {showAdvancedAudioControls && (
        <div
          className={`audio-track-pan-row ${audioHeaderDensity !== 'condensed' ? 'audio-track-pan-footer' : ''}`}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="audio-track-pan-label" aria-hidden="true">L</span>
          <input
            className="audio-track-pan-inline"
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={trackPan}
            aria-label={`${track.name} pan`}
            title={`Pan ${trackPanLabel}. Double-click to center.`}
            style={getAudioPanSliderStyle(trackPan)}
            onChange={handleTrackPanChange}
            onDoubleClick={handleTrackPanReset}
          />
          <span className="audio-track-pan-label" aria-hidden="true">R</span>
          <span className="audio-track-pan-value" aria-hidden="true">{trackPanLabel}</span>
        </div>
      )}
      {isMidiTrack && (
        <div
          className="midi-instrument-row"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="midi-instrument-icon" aria-hidden="true">{'\u266A'}</span>
          <select
            className="midi-instrument-select"
            value={midiInstrumentKind}
            aria-label={`${track.name} instrument`}
            title="MIDI instrument"
            onChange={(event) =>
              useTimelineStore.getState().setTrackMidiInstrument(track.id, {
                kind: event.currentTarget.value as MidiInstrument['kind'],
              })
            }
          >
            {MIDI_INSTRUMENT_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

export function TimelineHeaderMixerControls({
  effectiveMuted,
  effectiveSolo,
  onToggleLocked,
  onToggleMuted,
  onToggleSolo,
  popoverState,
  showAdvancedAudioControls,
  showAudioSummaryMeter,
  showAudioTrackVolumeFader,
  track,
  trackInputMonitor,
  trackRecordArm,
  trackVolumeDb,
  trackVolumeLabel,
  trackVolumeUnit,
}: {
  effectiveMuted: boolean | undefined;
  effectiveSolo: boolean | undefined;
  onToggleLocked?: () => void;
  onToggleMuted: () => void;
  onToggleSolo: () => void;
  popoverState: TimelineHeaderAudioPopoverState;
  showAdvancedAudioControls: boolean;
  showAudioSummaryMeter: boolean;
  showAudioTrackVolumeFader: boolean;
  track: HeaderTrack;
  trackInputMonitor: boolean;
  trackRecordArm: boolean;
  trackVolumeDb: number;
  trackVolumeLabel: string;
  trackVolumeUnit: number;
}) {
  const {
    audioFxOpen,
    audioFxPopoverRef,
    audioSendsOpen,
    audioSendsPopoverRef,
    toggleAudioFxOpen,
    toggleAudioSendsOpen,
  } = popoverState;

  const handleTrackVolumeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value));
  }, [track.id]);

  const handleTrackVolumeReset = useCallback((event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, 0);
  }, [track.id]);

  return (
    <>
      <div className="track-controls audio-strip-controls">
        {showAudioSummaryMeter ? (
          <>
            <button
              className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
              title={effectiveMuted ? 'Unmute' : 'Mute'}
            >
              M
            </button>
            <button
              className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
              title={track.locked ? 'Unlock Track' : 'Lock Track'}
            >
              <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
            </button>
            <button
              className={`btn-icon ${audioFxOpen || (track.audioState?.effectStack?.length ?? 0) > 0 ? 'btn-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleAudioFxOpen(); }}
              title="Track audio FX"
            >
              FX
            </button>
            <button
              className={`btn-icon ${(audioSendsOpen || (track.audioState?.sends?.length ?? 0) > 0) ? 'btn-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleAudioSendsOpen(); }}
              title="Track sends"
            >
              <span className="audio-button-label-wide">Aux</span>
              <span className="audio-button-label-short">A</span>
            </button>
          </>
        ) : showAdvancedAudioControls ? (
          <>
            <button
              className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
              title={effectiveSolo ? 'Solo On' : 'Solo Off'}
            >
              S
            </button>
            <button
              className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
              title={effectiveMuted ? 'Unmute' : 'Mute'}
            >
              M
            </button>
            <button
              className={`btn-icon ${trackInputMonitor ? 'btn-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                useTimelineStore.getState().updateTrackAudioState(track.id, { inputMonitor: !trackInputMonitor });
              }}
              title={trackInputMonitor ? 'Input monitor on' : 'Input monitor off'}
            >
              <TrackHeaderIcon name="speaker" />
            </button>
            <button
              className={`btn-icon ${trackRecordArm ? 'record-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                useTimelineStore.getState().updateTrackAudioState(track.id, { recordArm: !trackRecordArm });
              }}
              title={trackRecordArm ? 'Record armed' : 'Record arm'}
            >
              R
            </button>
            <button
              className={`btn-icon ${(audioSendsOpen || (track.audioState?.sends?.length ?? 0) > 0) ? 'btn-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleAudioSendsOpen(); }}
              title="Track sends"
            >
              <span className="audio-button-label-wide">Aux</span>
              <span className="audio-button-label-short">A</span>
            </button>
            <button
              className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
              title={track.locked ? 'Unlock Track' : 'Lock Track'}
            >
              <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
            </button>
            <button
              className={`btn-icon ${audioFxOpen || (track.audioState?.effectStack?.length ?? 0) > 0 ? 'btn-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleAudioFxOpen(); }}
              title="Track audio FX"
            >
              FX
            </button>
          </>
        ) : (
          <>
            <button
              className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
              title={effectiveSolo ? 'Solo On' : 'Solo Off'}
            >
              S
            </button>
            <button
              className={`btn-icon ${effectiveMuted ? 'muted' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleMuted(); }}
              title={effectiveMuted ? 'Unmute' : 'Mute'}
            >
              M
            </button>
            <button
              className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
              title={track.locked ? 'Unlock Track' : 'Lock Track'}
            >
              <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
            </button>
          </>
        )}
      </div>
      {showAdvancedAudioControls && (
        <div
          className="audio-track-faders"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <AudioLevelMeter
            streamScope={{ kind: 'track', trackId: track.id }}
            streamFeatures={['level']}
            label={`${track.name} level`}
            className="audio-track-level-meter"
            orientation="vertical"
            display="mono"
          />
          {showAudioTrackVolumeFader && (
            <div className="audio-track-fader-column">
              <div
                className="audio-track-fader-control"
                style={{ '--audio-track-volume-unit': trackVolumeUnit.toFixed(4) } as CSSProperties & { '--audio-track-volume-unit': string }}
              >
                <div className="audio-track-fader-rail" aria-hidden="true">
                  <div className="audio-track-fader-fill" />
                  <div className="audio-track-fader-thumb" />
                </div>
                <input
                  className="audio-track-fader"
                  type="range"
                  min="-60"
                  max="18"
                  step="0.5"
                  value={trackVolumeDb}
                  aria-label={`${track.name} volume`}
                  title={`Volume ${trackVolumeLabel} dB. Double-click to reset.`}
                  onChange={handleTrackVolumeChange}
                  onDoubleClick={handleTrackVolumeReset}
                />
              </div>
              <span className="audio-track-fader-value" aria-hidden="true">{trackVolumeLabel}</span>
            </div>
          )}
        </div>
      )}
      {showAdvancedAudioControls && audioFxOpen && (
        <div
          ref={audioFxPopoverRef}
          className="audio-track-popover audio-track-fx-popover"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <AudioEffectStackControl
            title={`${track.name} FX`}
            className="audio-effect-stack-compact"
            effects={track.audioState?.effectStack ?? []}
            runtimeAnalyzerScope="track"
            runtimeAnalyzerTrackId={track.id}
            emptyLabel="No track FX"
            onAddEffect={(descriptorId) => useTimelineStore.getState().addTrackAudioEffectInstance(track.id, descriptorId)}
            onUpdateEffect={(effect, paramName, value) => useTimelineStore.getState().updateTrackAudioEffectInstance(track.id, effect.id, { [paramName]: value })}
            onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setTrackAudioEffectInstanceEnabled(track.id, effectId, enabled)}
            onRemoveEffect={(effectId) => useTimelineStore.getState().removeTrackAudioEffectInstance(track.id, effectId)}
            onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderTrackAudioEffectInstance(track.id, effectId, newIndex)}
          />
        </div>
      )}
      {showAdvancedAudioControls && audioSendsOpen && (
        <div
          ref={audioSendsPopoverRef}
          className="audio-track-popover audio-track-sends-popover"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <TimelineHeaderAudioSends
            trackId={track.id}
            sends={track.audioState?.sends ?? []}
          />
        </div>
      )}
    </>
  );
}
