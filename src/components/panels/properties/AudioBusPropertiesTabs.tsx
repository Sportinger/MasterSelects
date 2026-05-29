import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  AudioEffectParamValue,
  AudioSendState,
  MasterAudioState,
  TimelineTrack,
  TrackAudioState,
} from '../../../types';
import { AudioEffectStackControl } from './AudioEffectStackControl';
import { AudioLevelMeter } from '../../timeline/components/AudioLevelMeter';
import { useRuntimeAudioMeterSnapshot } from '../../../services/audio/runtimeAudioMeterHooks';
import type { RuntimeAudioMeterScope } from '../../../services/audio/runtimeAudioMeterBus';

const BUS_METER_FEATURES = ['level', 'stereo', 'phase', 'dynamics'] as const;

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
  const valueLabel = formatDb(value);
  return valueLabel === '-inf' ? valueLabel : `${valueLabel} dB`;
}

function formatPan(value: number): string {
  if (Math.abs(value) < 0.005) return 'C';
  return value < 0 ? `L${Math.round(Math.abs(value) * 100)}` : `R${Math.round(value * 100)}`;
}

function formatOptionalNumber(value: number | undefined, fallback = '-'): string {
  return Number.isFinite(value) ? (value as number).toFixed(1) : fallback;
}

function useBusMeter(scope: RuntimeAudioMeterScope | undefined) {
  return useRuntimeAudioMeterSnapshot(scope, {
    features: BUS_METER_FEATURES,
    maxFps: 20,
  });
}

interface TrackTabProps {
  track: TimelineTrack;
}

export function AudioTrackControlsTab({ track }: TrackTabProps) {
  const audioState = getTrackAudioState(track);
  const meter = useBusMeter({ kind: 'track', trackId: track.id });
  const updateTrackAudioState = useTimelineStore(state => state.updateTrackAudioState);
  const setTrackAudioVolumeDb = useTimelineStore(state => state.setTrackAudioVolumeDb);
  const setTrackAudioPan = useTimelineStore(state => state.setTrackAudioPan);

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section audio-bus-meter-section">
        <h4>Track Meter</h4>
        <AudioLevelMeter
          meter={meter}
          label={`${track.name} level`}
          className="audio-bus-inline-meter"
          display="stereo"
        />
        <div className="audio-bus-meter-readout">
          <span>Peak {meter ? formatDbLong(meter.peakDb) : '-inf'}</span>
          <span>RMS {meter ? formatDbLong(meter.rmsDb) : '-inf'}</span>
          <span>Pan {formatPan(audioState.pan)}</span>
        </div>
      </div>

      <div className="properties-section">
        <h4>Level</h4>
        <label className="audio-bus-control-row">
          <span>Volume</span>
          <input
            type="range"
            min="-60"
            max="18"
            step="0.5"
            value={audioState.volumeDb}
            onChange={(event) => setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min="-60"
            max="18"
            step="0.5"
            value={audioState.volumeDb}
            onChange={(event) => setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value))}
          />
        </label>
        <label className="audio-bus-control-row">
          <span>Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={audioState.pan}
            onChange={(event) => setTrackAudioPan(track.id, Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min="-1"
            max="1"
            step="0.01"
            value={audioState.pan}
            onChange={(event) => setTrackAudioPan(track.id, Number(event.currentTarget.value))}
          />
        </label>
        <div className="audio-bus-toggle-grid">
          <label>
            <input
              type="checkbox"
              checked={audioState.muted}
              onChange={(event) => updateTrackAudioState(track.id, { muted: event.currentTarget.checked })}
            />
            <span>Mute</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={audioState.solo}
              onChange={(event) => updateTrackAudioState(track.id, { solo: event.currentTarget.checked })}
            />
            <span>Solo</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={audioState.recordArm}
              onChange={(event) => updateTrackAudioState(track.id, { recordArm: event.currentTarget.checked })}
            />
            <span>Record</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={audioState.inputMonitor}
              onChange={(event) => updateTrackAudioState(track.id, { inputMonitor: event.currentTarget.checked })}
            />
            <span>Input</span>
          </label>
        </div>
        <label className="audio-bus-control-row audio-bus-control-row-compact">
          <span>Meter</span>
          <select
            value={audioState.meterMode}
            onChange={(event) => updateTrackAudioState(track.id, { meterMode: event.currentTarget.value as TrackAudioState['meterMode'] })}
          >
            <option value="peak">Peak</option>
            <option value="rms">RMS</option>
            <option value="lufs">LUFS</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function AudioTrackEffectsTab({ track }: TrackTabProps) {
  const audioState = getTrackAudioState(track);
  const meter = useBusMeter({ kind: 'track', trackId: track.id });
  const dynamicsEffectIds = useMemo(
    () => audioState.effectStack?.map(effect => effect.id) ?? [],
    [audioState.effectStack],
  );

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section audio-effect-stack-section">
        <AudioEffectStackControl
          title={`${track.name} FX`}
          effects={audioState.effectStack ?? []}
          runtimeDynamics={meter?.dynamics}
          runtimeAnalyzerScope="track"
          runtimeAnalyzerTrackId={track.id}
          emptyLabel="No track FX"
          onAddEffect={(descriptorId) => useTimelineStore.getState().addTrackAudioEffectInstance(track.id, descriptorId)}
          onUpdateEffect={(effect, paramName, value) => {
            useTimelineStore.getState().updateTrackAudioEffectInstance(track.id, effect.id, { [paramName]: value });
          }}
          onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setTrackAudioEffectInstanceEnabled(track.id, effectId, enabled)}
          onRemoveEffect={(effectId) => useTimelineStore.getState().removeTrackAudioEffectInstance(track.id, effectId)}
          onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderTrackAudioEffectInstance(track.id, effectId, newIndex)}
        />
      </div>
      {dynamicsEffectIds.length > 0 && (
        <div className="audio-bus-telemetry-note">
          Live dynamics follow the selected track route.
        </div>
      )}
    </div>
  );
}

export function AudioTrackSendsTab({ track }: TrackTabProps) {
  const audioState = getTrackAudioState(track);
  const sends = audioState.sends ?? [];
  const addTrackAudioSend = useTimelineStore(state => state.addTrackAudioSend);
  const updateTrackAudioSend = useTimelineStore(state => state.updateTrackAudioSend);
  const removeTrackAudioSend = useTimelineStore(state => state.removeTrackAudioSend);
  const handleSendChange = useCallback((
    send: AudioSendState,
    patch: Partial<AudioSendState>,
  ) => {
    updateTrackAudioSend(track.id, send.id, patch);
  }, [track.id, updateTrackAudioSend]);

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section">
        <div className="section-header-row">
          <h4>Track Sends</h4>
          <button className="btn btn-sm" onClick={() => addTrackAudioSend(track.id)}>
            + Send
          </button>
        </div>
        {sends.length === 0 ? (
          <div className="audio-effect-stack-empty">No track sends</div>
        ) : (
          <div className="audio-bus-send-list">
            {sends.map((send) => (
              <div key={send.id} className={`audio-bus-send-item ${send.enabled === false ? 'bypassed' : ''}`}>
                <div className="audio-bus-send-header">
                  <input
                    type="text"
                    value={send.targetBusId}
                    aria-label="Send target bus"
                    onChange={(event) => handleSendChange(send, { targetBusId: event.currentTarget.value })}
                  />
                  <button
                    className="btn btn-sm"
                    onClick={() => handleSendChange(send, { enabled: send.enabled === false })}
                  >
                    {send.enabled === false ? 'Enable' : 'Bypass'}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => removeTrackAudioSend(track.id, send.id)}
                  >
                    Remove
                  </button>
                </div>
                <label className="audio-bus-control-row">
                  <span>Gain</span>
                  <input
                    type="range"
                    min="-60"
                    max="18"
                    step="0.5"
                    value={send.gainDb}
                    onChange={(event) => handleSendChange(send, { gainDb: Number(event.currentTarget.value) })}
                  />
                  <input
                    type="number"
                    min="-60"
                    max="18"
                    step="0.5"
                    value={send.gainDb}
                    onChange={(event) => handleSendChange(send, { gainDb: Number(event.currentTarget.value) })}
                  />
                </label>
                <label className="audio-bus-inline-toggle">
                  <input
                    type="checkbox"
                    checked={send.preFader}
                    onChange={(event) => handleSendChange(send, { preFader: event.currentTarget.checked })}
                  />
                  <span>Pre-fader</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface MasterTabProps {
  masterAudio: MasterAudioState;
}

export function MasterAudioControlsTab({ masterAudio }: MasterTabProps) {
  const meter = useBusMeter({ kind: 'master' });
  const updateMasterAudioState = useTimelineStore(state => state.updateMasterAudioState);
  const setMasterAudioVolumeDb = useTimelineStore(state => state.setMasterAudioVolumeDb);
  const setMasterLimiterEnabled = useTimelineStore(state => state.setMasterLimiterEnabled);
  const setMasterTargetLufs = useTimelineStore(state => state.setMasterTargetLufs);
  const setMasterTruePeakCeilingDb = useTimelineStore(state => state.setMasterTruePeakCeilingDb);
  const measurement = masterAudio.exportPreflight?.measurement;

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section audio-bus-meter-section">
        <h4>Master Meter</h4>
        <AudioLevelMeter
          meter={meter}
          label="Master level"
          className="audio-bus-inline-meter"
          display="stereo"
        />
        <div className="audio-bus-meter-readout">
          <span>Peak {meter ? formatDbLong(meter.peakDb) : '-inf'}</span>
          <span>RMS {meter ? formatDbLong(meter.rmsDb) : '-inf'}</span>
          <span>LUFS {formatOptionalNumber(measurement?.integratedLufs, formatOptionalNumber(masterAudio.targetLufs))}</span>
        </div>
      </div>

      <div className="properties-section">
        <h4>Output</h4>
        <label className="audio-bus-control-row">
          <span>Volume</span>
          <input
            type="range"
            min="-60"
            max="18"
            step="0.5"
            value={masterAudio.volumeDb}
            onChange={(event) => setMasterAudioVolumeDb(Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min="-60"
            max="18"
            step="0.5"
            value={masterAudio.volumeDb}
            onChange={(event) => setMasterAudioVolumeDb(Number(event.currentTarget.value))}
          />
        </label>
        <label className="audio-bus-control-row">
          <span>True Peak</span>
          <input
            type="range"
            min="-24"
            max="0"
            step="0.1"
            value={masterAudio.truePeakCeilingDb}
            onChange={(event) => setMasterTruePeakCeilingDb(Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min="-24"
            max="0"
            step="0.1"
            value={masterAudio.truePeakCeilingDb}
            onChange={(event) => setMasterTruePeakCeilingDb(Number(event.currentTarget.value))}
          />
        </label>
        <label className="audio-bus-control-row">
          <span>Target LUFS</span>
          <input
            type="range"
            min="-36"
            max="-5"
            step="0.5"
            value={masterAudio.targetLufs ?? -14}
            onChange={(event) => setMasterTargetLufs(Number(event.currentTarget.value))}
          />
          <input
            type="number"
            min="-36"
            max="-5"
            step="0.5"
            value={masterAudio.targetLufs ?? -14}
            onChange={(event) => setMasterTargetLufs(Number(event.currentTarget.value))}
          />
        </label>
        <div className="audio-bus-toggle-grid">
          <label>
            <input
              type="checkbox"
              checked={masterAudio.limiterEnabled}
              onChange={(event) => setMasterLimiterEnabled(event.currentTarget.checked)}
            />
            <span>Limiter</span>
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => updateMasterAudioState({ exportPreflight: undefined })}
            disabled={!masterAudio.exportPreflight}
          >
            Clear Preflight
          </button>
        </div>
      </div>
    </div>
  );
}

export function MasterAudioEffectsTab({ masterAudio }: MasterTabProps) {
  const meter = useBusMeter({ kind: 'master' });

  return (
    <div className="properties-tab-content audio-bus-properties-tab">
      <div className="properties-section audio-effect-stack-section">
        <AudioEffectStackControl
          title="Master FX"
          effects={masterAudio.effectStack ?? []}
          runtimeDynamics={meter?.dynamics}
          runtimeAnalyzerScope="master"
          emptyLabel="No master FX"
          onAddEffect={(descriptorId) => useTimelineStore.getState().addMasterAudioEffectInstance(descriptorId)}
          onUpdateEffect={(effect, paramName, value: AudioEffectParamValue) => {
            useTimelineStore.getState().updateMasterAudioEffectInstance(effect.id, { [paramName]: value });
          }}
          onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setMasterAudioEffectInstanceEnabled(effectId, enabled)}
          onRemoveEffect={(effectId) => useTimelineStore.getState().removeMasterAudioEffectInstance(effectId)}
          onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderMasterAudioEffectInstance(effectId, newIndex)}
        />
      </div>
    </div>
  );
}
