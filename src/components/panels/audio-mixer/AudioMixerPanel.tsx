import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './AudioMixerPanel.css';
import { useTimelineStore } from '../../../stores/timeline';
import type { LabelColor } from '../../../stores/mediaStore/types';
import type {
  AudioEffectInstance,
  AudioExportPreflightState,
  AudioSendState,
  MasterAudioState,
  TimelineTrack,
  TrackAudioState,
} from '../../../types';
import { AudioExportPipeline } from '../../../engine/audio/AudioExportPipeline';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { getAudioEffect } from '../../../engine/audio/AudioEffectRegistry';
import { AudioEffectStackControl } from '../properties/AudioEffectStackControl';
import { AudioEqualizerInstanceList } from '../properties/AudioEqualizerInstanceList';
import { AudioLevelMeter } from '../../timeline/components/AudioLevelMeter';
import { getAudioPanSliderStyle } from '../../timeline/utils/audioPanSliderStyle';
import { collectAudioEqInstances, type AudioEqInstanceDescriptor } from '../../../engine/audio';
import { LABEL_COLORS, getLabelHex } from '../media/labelColors';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import { getTimelineTrackColor, getTrackLabelColor } from '../../timeline/trackColor';

const DEFAULT_MASTER_AUDIO_STATE: MasterAudioState = {
  volumeDb: 0,
  limiterEnabled: false,
  truePeakCeilingDb: -1,
  targetLufs: -14,
  effectStack: [],
};

const MASTER_FOCUS_ID = '__master__';

type MixerCssProperties = CSSProperties & {
  '--strip-color'?: string;
};

type FxWindowTarget =
  | { scope: 'track'; trackId: string; effectId?: string }
  | { scope: 'master'; effectId?: string };

type TrackColorMenuTarget = {
  x: number;
  y: number;
  trackId: string;
};

function getTrackAudioState(track: TimelineTrack): TrackAudioState {
  return {
    volumeDb: 0,
    pan: 0,
    muted: track.muted,
    solo: track.solo,
    recordArm: false,
    inputMonitor: false,
    meterMode: 'peak',
    ...(track.audioState ?? {}),
  };
}

function formatDb(value: number): string {
  if (!Number.isFinite(value)) return '-inf';
  return value <= -99 ? '-inf' : value.toFixed(1);
}

function formatDbLong(value: number): string {
  const formatted = formatDb(value);
  return formatted === '-inf' ? formatted : `${formatted} dB`;
}

function formatPan(value: number): string {
  if (Math.abs(value) < 0.005) return 'C';
  return value < 0 ? `L${Math.round(Math.abs(value) * 100)}` : `R${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0s';
  return `${value.toFixed(1)}s`;
}

function getPreflightStatus(preflight: AudioExportPreflightState | undefined): {
  label: string;
  className: string;
} {
  const warnings = preflight?.warnings ?? [];
  if (warnings.some(warning => warning.severity === 'error')) {
    return { label: 'Error', className: 'error' };
  }
  if (warnings.some(warning => warning.severity === 'warning')) {
    return { label: 'Warning', className: 'warning' };
  }
  if (preflight?.measurement) {
    return { label: 'Measured', className: 'ok' };
  }
  if (preflight?.lastCheckedAt) {
    return { label: 'Checked', className: 'ok' };
  }
  return { label: 'Not checked', className: '' };
}

function getEffectName(effect: AudioEffectInstance): string {
  return getAudioEffect(effect.descriptorId)?.name ?? effect.descriptorId;
}

function getEffectRackLabel(effect: AudioEffectInstance): string {
  const name = getEffectName(effect);
  return name.length > 17 ? `${name.slice(0, 16)}...` : name;
}

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function MixerMeterScale() {
  return (
    <div className="audio-mixer-meter-scale-labels" aria-hidden="true">
      <span>+3</span>
      <span>0</span>
      <span>-5</span>
      <span>-10</span>
      <span>-18</span>
      <span>-30</span>
      <span>-50</span>
    </div>
  );
}

function MixerRack({
  effects,
  sends,
  onOpenEffect,
  onAddSend,
  onToggleSend,
}: {
  effects: readonly AudioEffectInstance[];
  sends: readonly AudioSendState[];
  onOpenEffect: (effectId?: string) => void;
  onAddSend?: () => void;
  onToggleSend?: (send: AudioSendState) => void;
}) {
  return (
    <div className="audio-mixer-rack" onPointerDown={stopPropagation}>
      <div className="audio-mixer-rack-group inserts">
        {effects.length === 0 ? (
          <button type="button" className="audio-mixer-rack-slot empty" onClick={() => onOpenEffect()}>
            FX
          </button>
        ) : (
          effects.slice(0, 6).map((effect) => (
            <button
              type="button"
              key={effect.id}
              className={`audio-mixer-rack-slot ${effect.enabled === false ? 'bypassed' : ''}`}
              onClick={() => onOpenEffect(effect.id)}
              title={getEffectName(effect)}
            >
              <i />
              <span>{getEffectRackLabel(effect)}</span>
            </button>
          ))
        )}
        {effects.length > 6 && (
          <button type="button" className="audio-mixer-rack-slot more" onClick={() => onOpenEffect()}>
            +{effects.length - 6} FX
          </button>
        )}
      </div>

      <div className="audio-mixer-rack-group sends">
        {sends.slice(0, 3).map((send) => (
          <button
            type="button"
            key={send.id}
            className={`audio-mixer-rack-slot send ${send.enabled === false ? 'bypassed' : ''}`}
            onClick={() => onToggleSend?.(send)}
            title={`${send.targetBusId} ${formatDbLong(send.gainDb)} ${send.preFader ? 'pre' : 'post'}`}
          >
            <i />
            <span>{send.targetBusId || 'bus'}</span>
          </button>
        ))}
        {onAddSend && (
          <button type="button" className="audio-mixer-rack-slot send-add" onClick={onAddSend}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

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
  const meter = useTimelineStore(state => state.runtimeAudioMeters.trackMeters[track.id]);
  const audioState = getTrackAudioState(track);
  const effectiveMuted = audioState.muted;
  const effectiveSolo = audioState.solo;
  const effects = audioState.effectStack ?? [];
  const sends = audioState.sends ?? [];
  const stripStyle: MixerCssProperties = { '--strip-color': getTimelineTrackColor(track, index) };
  const resetTrackPan = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioPan(track.id, 0);
  };
  const resetTrackVolume = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setTrackAudioVolumeDb(track.id, 0);
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
        <span>{formatDb(audioState.volumeDb)}</span>
        <span>{formatPan(audioState.pan)}</span>
      </div>

      <div className="audio-mixer-fader-meter" onPointerDown={stopPropagation}>
        <input
          className="audio-mixer-strip-fader"
          type="range"
          min="-60"
          max="18"
          step="0.5"
          value={audioState.volumeDb}
          aria-label={`${track.name} volume`}
          title="Double-click to reset volume to 0 dB"
          onChange={(event) => useTimelineStore.getState().setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value))}
          onDoubleClick={resetTrackVolume}
        />
        <AudioLevelMeter
          meter={meter}
          label={`${track.name} level`}
          className="audio-mixer-meter"
          orientation="vertical"
          display="stereo"
        />
        <MixerMeterScale />
      </div>

      <div className="audio-mixer-strip-output">
        <span>Post</span>
        <strong>{meter ? formatDbLong(meter.peakDb) : '-inf'}</strong>
      </div>
    </section>
  );
}

const TrackMixerStrip = memo(TrackMixerStripComponent, (prev, next) => (
  prev.track === next.track
  && prev.index === next.index
  && prev.focused === next.focused
  && prev.onOpenFx === next.onOpenFx
  && prev.onOpenColorMenu === next.onOpenColorMenu
));

function MasterMixerStripComponent({
  masterAudio,
  focused,
  preflightMeasuring,
  onFocus,
  onOpenFx,
  onStaticPreflight,
  onRenderedPreflight,
}: {
  masterAudio: MasterAudioState;
  focused: boolean;
  preflightMeasuring: boolean;
  onFocus: () => void;
  onOpenFx: (target: FxWindowTarget) => void;
  onStaticPreflight: () => void;
  onRenderedPreflight: () => void;
}) {
  const meter = useTimelineStore(state => state.runtimeAudioMeters.master);
  const status = getPreflightStatus(masterAudio.exportPreflight);
  const measurement = masterAudio.exportPreflight?.measurement;
  const effects = masterAudio.effectStack ?? [];
  const stripStyle: MixerCssProperties = { '--strip-color': '#4a9eff' };
  const resetMasterVolume = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    useTimelineStore.getState().setMasterAudioVolumeDb(0);
  };

  return (
    <section
      className={`audio-mixer-strip master ${focused ? 'focused' : ''} ${masterAudio.limiterEnabled ? 'limited' : ''}`}
      style={stripStyle}
      onClick={onFocus}
    >
      <div className="audio-mixer-strip-color" aria-hidden="true" />

      <div className="audio-mixer-strip-name">
        <strong>Master</strong>
        <span>bus</span>
      </div>

      <MixerRack
        effects={effects}
        sends={[]}
        onOpenEffect={(effectId) => {
          onFocus();
          onOpenFx({ scope: 'master', effectId });
        }}
      />

      <div className="audio-mixer-master-readout">
        <span>LUFS {measurement?.integratedLufs?.toFixed(1) ?? (masterAudio.targetLufs ?? -14).toFixed(1)}</span>
        <span>TP {measurement?.truePeakDbtp?.toFixed(1) ?? masterAudio.truePeakCeilingDb.toFixed(1)}</span>
        <em className={status.className}>{status.label}</em>
      </div>

      <label className="audio-mixer-limiter-row" onPointerDown={stopPropagation}>
        <input
          type="checkbox"
          checked={masterAudio.limiterEnabled}
          onChange={(event) => useTimelineStore.getState().setMasterLimiterEnabled(event.currentTarget.checked)}
        />
        <span>Limiter</span>
      </label>

      <div className="audio-mixer-preflight-actions compact" onPointerDown={stopPropagation}>
        <button type="button" onClick={onStaticPreflight}>Check</button>
        <button type="button" onClick={onRenderedPreflight} disabled={preflightMeasuring}>
          {preflightMeasuring ? 'Measuring' : 'Measure'}
        </button>
      </div>

      <div className="audio-mixer-value-row">
        <span>{formatDb(masterAudio.volumeDb)}</span>
        <span>TP {masterAudio.truePeakCeilingDb.toFixed(1)}</span>
      </div>

      <div className="audio-mixer-fader-meter master" onPointerDown={stopPropagation}>
        <input
          className="audio-mixer-strip-fader"
          type="range"
          min="-60"
          max="18"
          step="0.5"
          value={masterAudio.volumeDb}
          aria-label="Master volume"
          title="Double-click to reset volume to 0 dB"
          onChange={(event) => useTimelineStore.getState().setMasterAudioVolumeDb(Number(event.currentTarget.value))}
          onDoubleClick={resetMasterVolume}
        />
        <AudioLevelMeter
          meter={meter}
          label="Master level"
          className="audio-mixer-meter"
          orientation="vertical"
          display="stereo"
        />
        <MixerMeterScale />
      </div>

      <div className="audio-mixer-strip-output">
        <span>Master</span>
        <strong>{meter ? formatDbLong(meter.peakDb) : '-inf'}</strong>
      </div>
    </section>
  );
}

const MasterMixerStrip = memo(MasterMixerStripComponent, (prev, next) => (
  prev.masterAudio === next.masterAudio
  && prev.focused === next.focused
  && prev.preflightMeasuring === next.preflightMeasuring
  && prev.onOpenFx === next.onOpenFx
  && prev.onStaticPreflight === next.onStaticPreflight
  && prev.onRenderedPreflight === next.onRenderedPreflight
));

function MixerFxWindow({
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
  const meter = useTimelineStore(state => {
    if (!target) return undefined;
    return target.scope === 'track'
      ? state.runtimeAudioMeters.trackMeters[target.trackId]
      : state.runtimeAudioMeters.master;
  });
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
        runtimeDynamics={meter?.dynamics}
        runtimeAnalyzer={meter?.spectrumDb ? { postDb: meter.spectrumDb } : undefined}
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

function MixerTrackColorMenu({
  target,
  tracks,
  onClose,
}: {
  target: TrackColorMenuTarget | null;
  tracks: readonly TimelineTrack[];
  onClose: () => void;
}) {
  const { menuRef, adjustedPosition } = useContextMenuPosition(target);

  useEffect(() => {
    if (!target) return undefined;

    const handlePointerOutside = (event: PointerEvent | MouseEvent) => {
      const eventTarget = event.target;
      if (eventTarget instanceof Node && menuRef.current?.contains(eventTarget)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerOutside, true);
      document.addEventListener('contextmenu', handlePointerOutside, true);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('pointerdown', handlePointerOutside, true);
      document.removeEventListener('contextmenu', handlePointerOutside, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuRef, onClose, target]);

  if (!target) return null;

  const track = tracks.find(candidate => candidate.id === target.trackId);
  if (!track) return null;

  const trackIndex = tracks.findIndex(candidate => candidate.id === target.trackId);
  const currentColor = getTrackLabelColor(track);
  const currentColorHex = currentColor === 'none'
    ? getTimelineTrackColor(track, trackIndex)
    : getLabelHex(currentColor);
  const handleSetTrackColor = (color: LabelColor) => {
    useTimelineStore.getState().setTrackLabelColor(track.id, color);
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="timeline-context-menu audio-mixer-track-color-menu"
      style={{
        position: 'fixed',
        left: adjustedPosition?.x ?? target.x,
        top: adjustedPosition?.y ?? target.y,
        zIndex: 10000,
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu-item disabled">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="clip-color-indicator"
            style={{
              background: currentColorHex,
              width: 10,
              height: 10,
              borderRadius: 2,
              border: '1px solid rgba(255,255,255,0.2)',
              flexShrink: 0,
            }}
          />
          {track.name}
        </span>
      </div>
      <div className="context-menu-separator" />
      <div className="clip-color-grid audio-mixer-track-color-grid">
        {LABEL_COLORS.map(color => (
          <span
            key={color.key}
            className={`label-picker-swatch ${color.key === 'none' ? 'none' : ''} ${currentColor === color.key ? 'active' : ''}`}
            title={color.name}
            style={{ background: color.key === 'none' ? 'var(--bg-tertiary)' : color.hex }}
            onClick={() => handleSetTrackColor(color.key)}
          >
            {color.key === 'none' && <span className="label-picker-x">&times;</span>}
          </span>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function AudioMixerPanel() {
  const tracks = useTimelineStore(state => state.tracks);
  const clips = useTimelineStore(state => state.clips);
  const selectClip = useTimelineStore(state => state.selectClip);
  const duration = useTimelineStore(state => state.duration);
  const inPoint = useTimelineStore(state => state.inPoint);
  const outPoint = useTimelineStore(state => state.outPoint);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const runAudioExportPreflight = useTimelineStore(state => state.runAudioExportPreflight);
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  const [preflightMeasuring, setPreflightMeasuring] = useState(false);
  const [focusedStripId, setFocusedStripId] = useState<string>(MASTER_FOCUS_ID);
  const [fxWindowTarget, setFxWindowTarget] = useState<FxWindowTarget | null>(null);
  const [trackColorMenuTarget, setTrackColorMenuTarget] = useState<TrackColorMenuTarget | null>(null);

  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  const audioTracks = useMemo(
    () => tracks.filter(track => track.type === 'audio'),
    [tracks],
  );
  useEffect(() => {
    const hasFocusedTrack = audioTracks.some(track => track.id === focusedStripId);
    if (focusedStripId !== MASTER_FOCUS_ID && !hasFocusedTrack) {
      setFocusedStripId(audioTracks[0]?.id ?? MASTER_FOCUS_ID);
    }
  }, [audioTracks, focusedStripId]);

  useEffect(() => {
    if (fxWindowTarget?.scope === 'track' && !audioTracks.some(track => track.id === fxWindowTarget.trackId)) {
      setFxWindowTarget(null);
    }
  }, [audioTracks, fxWindowTarget]);

  const masterAudio = masterAudioState ?? DEFAULT_MASTER_AUDIO_STATE;
  const eqInstances = useMemo(
    () => collectAudioEqInstances({ clips, tracks: audioTracks, masterAudioState: masterAudio }),
    [audioTracks, clips, masterAudio],
  );
  const recoveryEntries = recordingState.recoveryEntries ?? audioRecordingService.listRecoveryEntries();

  const handleStaticPreflight = useCallback(() => {
    runAudioExportPreflight(inPoint ?? 0, outPoint ?? duration);
  }, [duration, inPoint, outPoint, runAudioExportPreflight]);

  const handleRenderedPreflight = useCallback(async () => {
    if (preflightMeasuring) return;
    setPreflightMeasuring(true);
    try {
      const start = inPoint ?? 0;
      const end = outPoint ?? duration;
      runAudioExportPreflight(start, end);
      const pipeline = new AudioExportPipeline({ sampleRate: 48000, normalize: false });
      const renderedBuffer = await pipeline.exportRawAudio(start, end);
      runAudioExportPreflight(start, end, renderedBuffer);
    } catch (error) {
      useTimelineStore.getState().updateMasterAudioState({
        exportPreflight: {
          lastCheckedAt: Date.now(),
          warnings: [{
            code: 'audio-mixer-rendered-preflight-failed',
            message: error instanceof Error ? error.message : 'Rendered audio preflight failed.',
            severity: 'error',
          }],
        },
      });
    } finally {
      setPreflightMeasuring(false);
    }
  }, [duration, inPoint, outPoint, preflightMeasuring, runAudioExportPreflight]);

  const handleJumpToEqInstance = useCallback((instance: AudioEqInstanceDescriptor) => {
    if (instance.scope === 'clip') {
      selectClip(instance.ownerId);
    }
  }, [selectClip]);

  const handleOpenTrackColorMenu = useCallback((event: ReactMouseEvent, trackId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setFocusedStripId(trackId);
    setTrackColorMenuTarget({
      x: event.clientX,
      y: event.clientY,
      trackId,
    });
  }, []);

  const handleCommitRecovery = useCallback(async (sessionId: string) => {
    try {
      await audioRecordingService.commitRecoveryEntry(sessionId);
    } catch (error) {
      useTimelineStore.getState().updateMasterAudioState({
        exportPreflight: {
          lastCheckedAt: Date.now(),
          warnings: [{
            code: 'audio-recording-recovery-commit-failed',
            message: error instanceof Error ? error.message : 'Recovered recording commit failed.',
            severity: 'error',
          }],
        },
      });
    }
  }, []);

  const focusedIsMaster = focusedStripId === MASTER_FOCUS_ID;

  return (
    <div className="audio-mixer-panel">
      {recoveryEntries.length > 0 && (
        <div className="audio-mixer-recovery-list">
          {recoveryEntries.slice(0, 4).map(entry => (
            <div key={entry.sessionId} className={`audio-mixer-recovery-item ${entry.status}`}>
              <span>{entry.status}</span>
              <p>
                {entry.targetTrackIds.length} track{entry.targetTrackIds.length === 1 ? '' : 's'} at {formatSeconds(entry.startTime)}
                {entry.punchOutTime !== undefined ? ` -> ${formatSeconds(entry.punchOutTime)}` : ''}
                {entry.message ? ` / ${entry.message}` : ''}
              </p>
              {entry.status === 'stopped' && entry.assets && entry.assets.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleCommitRecovery(entry.sessionId)}
                  title="Commit recovered recording"
                >
                  Add
                </button>
              )}
              <button
                type="button"
                onClick={() => void audioRecordingService.dismissRecoveryEntry(entry.sessionId)}
                title="Dismiss recovery entry"
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}

      {eqInstances.length > 0 && (
        <AudioEqualizerInstanceList
          instances={eqInstances}
          onJump={handleJumpToEqInstance}
        />
      )}

      <div className="audio-mixer-body">
        <div className="audio-mixer-console">
          <div className="audio-mixer-track-scroll">
            <div className="audio-mixer-strip-grid">
              {audioTracks.map((track, index) => (
                <TrackMixerStrip
                  key={track.id}
                  track={track}
                  index={index}
                  focused={focusedStripId === track.id}
                  onFocus={() => setFocusedStripId(track.id)}
                  onOpenFx={setFxWindowTarget}
                  onOpenColorMenu={handleOpenTrackColorMenu}
                />
              ))}
            </div>
          </div>

          <div className="audio-mixer-master-bay">
            <MasterMixerStrip
              masterAudio={masterAudio}
              focused={focusedIsMaster}
              preflightMeasuring={preflightMeasuring}
              onFocus={() => setFocusedStripId(MASTER_FOCUS_ID)}
              onOpenFx={setFxWindowTarget}
              onStaticPreflight={handleStaticPreflight}
              onRenderedPreflight={handleRenderedPreflight}
            />
          </div>
        </div>

        <MixerFxWindow
          target={fxWindowTarget}
          tracks={audioTracks}
          masterAudio={masterAudio}
          onClose={() => setFxWindowTarget(null)}
        />
        <MixerTrackColorMenu
          target={trackColorMenuTarget}
          tracks={audioTracks}
          onClose={() => setTrackColorMenuTarget(null)}
        />
      </div>
    </div>
  );
}
