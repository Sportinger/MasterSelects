import { useCallback, useEffect, useMemo, useState } from 'react';
import './AudioMixerPanel.css';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  AudioExportPreflightState,
  AudioSendState,
  MasterAudioState,
  TimelineTrack,
  TrackAudioState,
} from '../../../types';
import { AudioExportPipeline } from '../../../engine/audio/AudioExportPipeline';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import {
  isAudioRecordingActivePhase,
  resolveTimelineRecordingRange,
  toggleTimelineAudioRecording,
} from '../../../services/audio/timelineRecordingWorkflow';
import { AudioEffectStackControl } from '../properties/AudioEffectStackControl';
import { AudioLevelMeter } from '../../timeline/components/AudioLevelMeter';

const DEFAULT_MASTER_AUDIO_STATE: MasterAudioState = {
  volumeDb: 0,
  limiterEnabled: false,
  truePeakCeilingDb: -1,
  targetLufs: -14,
  effectStack: [],
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
  return `${value.toFixed(1)} dB`;
}

function formatPan(value: number): string {
  if (Math.abs(value) < 0.005) return 'C';
  return value < 0 ? `L${Math.round(Math.abs(value) * 100)}` : `R${Math.round(value * 100)}`;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0s';
  return `${value.toFixed(1)}s`;
}

function formatClock(timestamp: number | undefined): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '--:--:--';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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

function getRecordingLabel(phase: string): string {
  switch (phase) {
    case 'waiting-for-punch':
      return 'Waiting for punch';
    case 'warming-input':
      return 'Warming input';
    case 'requesting-input':
      return 'Requesting input';
    case 'recording':
      return 'Recording';
    case 'stopping':
      return 'Stopping';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function TrackSendControls({
  trackId,
  sends,
}: {
  trackId: string;
  sends: readonly AudioSendState[];
}) {
  const addSend = useCallback(() => {
    useTimelineStore.getState().addTrackAudioSend(trackId);
  }, [trackId]);

  return (
    <div className="audio-mixer-send-list">
      <div className="audio-mixer-section-head">
        <span>Sends</span>
        <button type="button" onClick={addSend}>+ Send</button>
      </div>
      {sends.length === 0 ? (
        <div className="audio-mixer-empty">No sends</div>
      ) : (
        sends.map((send, index) => (
          <div className="audio-mixer-send-row" key={send.id}>
            <button
              type="button"
              className={`audio-mixer-mini-toggle ${send.enabled !== false ? 'active' : ''}`}
              onClick={() => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { enabled: send.enabled === false })}
              title={send.enabled === false ? 'Enable send' : 'Bypass send'}
            >
              {index + 1}
            </button>
            <input
              type="text"
              value={send.targetBusId}
              onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { targetBusId: event.currentTarget.value })}
              aria-label="Send target bus"
            />
            <input
              type="range"
              min="-60"
              max="18"
              step="0.5"
              value={send.gainDb}
              onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { gainDb: Number(event.currentTarget.value) })}
              aria-label="Send gain"
            />
            <span>{formatDb(send.gainDb)}</span>
            <label title="Pre-fader send">
              <input
                type="checkbox"
                checked={send.preFader}
                onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { preFader: event.currentTarget.checked })}
              />
              Pre
            </label>
            <button
              type="button"
              className="audio-mixer-remove"
              onClick={() => useTimelineStore.getState().removeTrackAudioSend(trackId, send.id)}
              title="Remove send"
            >
              x
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function TrackMixerStrip({
  track,
}: {
  track: TimelineTrack;
}) {
  const meter = useTimelineStore(state => state.runtimeAudioMeters.trackMeters[track.id]);
  const audioState = getTrackAudioState(track);
  const effectiveMuted = audioState.muted;
  const effectiveSolo = audioState.solo;

  return (
    <section className={`audio-mixer-strip ${effectiveMuted ? 'muted' : ''} ${audioState.recordArm ? 'armed' : ''}`}>
      <div className="audio-mixer-strip-header">
        <strong title={track.name}>{track.name}</strong>
        <span>{formatDb(audioState.volumeDb)}</span>
      </div>

      <div className="audio-mixer-button-row">
        <button
          type="button"
          className={effectiveSolo ? 'active' : ''}
          onClick={() => useTimelineStore.getState().setTrackSolo(track.id, !effectiveSolo)}
          title={effectiveSolo ? 'Solo On' : 'Solo Off'}
        >
          S
        </button>
        <button
          type="button"
          className={effectiveMuted ? 'active' : ''}
          onClick={() => useTimelineStore.getState().setTrackMuted(track.id, !effectiveMuted)}
          title={effectiveMuted ? 'Unmute' : 'Mute'}
        >
          M
        </button>
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
          I
        </button>
      </div>

      <AudioLevelMeter meter={meter} label={`${track.name} level`} className="audio-mixer-meter" />

      <label className="audio-mixer-control-row">
        <span>Volume</span>
        <input
          type="range"
          min="-60"
          max="18"
          step="0.5"
          value={audioState.volumeDb}
          onChange={(event) => useTimelineStore.getState().setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value))}
        />
        <input
          type="number"
          min="-60"
          max="18"
          step="0.5"
          value={audioState.volumeDb}
          onChange={(event) => useTimelineStore.getState().setTrackAudioVolumeDb(track.id, Number(event.currentTarget.value))}
        />
      </label>

      <label className="audio-mixer-control-row">
        <span>Pan</span>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={audioState.pan}
          onChange={(event) => useTimelineStore.getState().setTrackAudioPan(track.id, Number(event.currentTarget.value))}
        />
        <output>{formatPan(audioState.pan)}</output>
      </label>

      <label className="audio-mixer-control-row">
        <span>Input</span>
        <input
          type="text"
          value={audioState.inputDeviceId ?? ''}
          placeholder="default"
          onChange={(event) => useTimelineStore.getState().updateTrackAudioState(track.id, {
            inputDeviceId: event.currentTarget.value.trim() || undefined,
          })}
        />
      </label>

      <details className="audio-mixer-section" open={(audioState.sends?.length ?? 0) > 0}>
        <summary>Sends {(audioState.sends?.length ?? 0) > 0 ? `(${audioState.sends?.length})` : ''}</summary>
        <TrackSendControls trackId={track.id} sends={audioState.sends ?? []} />
      </details>

      <details className="audio-mixer-section" open={(audioState.effectStack?.length ?? 0) > 0}>
        <summary>Track FX {(audioState.effectStack?.length ?? 0) > 0 ? `(${audioState.effectStack?.length})` : ''}</summary>
        <AudioEffectStackControl
          title={`${track.name} FX`}
          className="audio-effect-stack-compact audio-mixer-fx-stack"
          effects={audioState.effectStack ?? []}
          runtimeDynamics={meter?.dynamics}
          emptyLabel="No track FX"
          onAddEffect={(descriptorId) => useTimelineStore.getState().addTrackAudioEffectInstance(track.id, descriptorId)}
          onUpdateEffect={(effect, paramName, value) => useTimelineStore.getState().updateTrackAudioEffectInstance(track.id, effect.id, { [paramName]: value })}
          onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setTrackAudioEffectInstanceEnabled(track.id, effectId, enabled)}
          onRemoveEffect={(effectId) => useTimelineStore.getState().removeTrackAudioEffectInstance(track.id, effectId)}
          onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderTrackAudioEffectInstance(track.id, effectId, newIndex)}
        />
      </details>
    </section>
  );
}

function MasterMixerStrip({
  masterAudio,
  preflightMeasuring,
  onStaticPreflight,
  onRenderedPreflight,
}: {
  masterAudio: MasterAudioState;
  preflightMeasuring: boolean;
  onStaticPreflight: () => void;
  onRenderedPreflight: () => void;
}) {
  const meter = useTimelineStore(state => state.runtimeAudioMeters.master);
  const preflight = masterAudio.exportPreflight;
  const status = getPreflightStatus(preflight);
  const warnings = preflight?.warnings ?? [];
  const measurement = preflight?.measurement;
  const measurementHistory = preflight?.measurementHistory ?? [];

  return (
    <section className={`audio-mixer-strip master ${masterAudio.limiterEnabled ? 'limited' : ''}`}>
      <div className="audio-mixer-strip-header">
        <strong>Master</strong>
        <span>{formatDb(masterAudio.volumeDb)}</span>
      </div>

      <AudioLevelMeter meter={meter} label="Master level" className="audio-mixer-meter" />

      <label className="audio-mixer-control-row">
        <span>Volume</span>
        <input
          type="range"
          min="-60"
          max="18"
          step="0.5"
          value={masterAudio.volumeDb}
          onChange={(event) => useTimelineStore.getState().setMasterAudioVolumeDb(Number(event.currentTarget.value))}
        />
        <input
          type="number"
          min="-60"
          max="18"
          step="0.5"
          value={masterAudio.volumeDb}
          onChange={(event) => useTimelineStore.getState().setMasterAudioVolumeDb(Number(event.currentTarget.value))}
        />
      </label>

      <label className="audio-mixer-check-row">
        <input
          type="checkbox"
          checked={masterAudio.limiterEnabled}
          onChange={(event) => useTimelineStore.getState().setMasterLimiterEnabled(event.currentTarget.checked)}
        />
        <span>Limiter</span>
      </label>

      <label className="audio-mixer-control-row compact">
        <span>True Peak</span>
        <input
          type="number"
          min="-24"
          max="0"
          step="0.1"
          value={masterAudio.truePeakCeilingDb}
          onChange={(event) => useTimelineStore.getState().setMasterTruePeakCeilingDb(Number(event.currentTarget.value))}
        />
      </label>

      <label className="audio-mixer-control-row compact">
        <span>Target LUFS</span>
        <input
          type="number"
          min="-36"
          max="-5"
          step="0.5"
          value={masterAudio.targetLufs ?? -14}
          onChange={(event) => useTimelineStore.getState().setMasterTargetLufs(Number(event.currentTarget.value))}
        />
      </label>

      <div className="audio-mixer-preflight">
        <div className="audio-mixer-section-head">
          <span>Preflight</span>
          <span className={`audio-mixer-status ${status.className}`}>{status.label}</span>
        </div>
        <div className="audio-mixer-preflight-actions">
          <button type="button" onClick={onStaticPreflight}>Check</button>
          <button type="button" onClick={onRenderedPreflight} disabled={preflightMeasuring}>
            {preflightMeasuring ? 'Measuring' : 'Measure'}
          </button>
        </div>
        {measurement && (
          <div className="audio-mixer-measurements">
            <span>LUFS {measurement.integratedLufs?.toFixed(1) ?? 'n/a'}</span>
            <span>TP {measurement.truePeakDbtp?.toFixed(1) ?? 'n/a'} dBTP</span>
            <span>RMS {measurement.rmsDbfs?.toFixed(1) ?? 'n/a'} dBFS</span>
          </div>
        )}
        {measurementHistory.length > 0 && (
          <details className="audio-mixer-measurement-history" open={measurementHistory.length > 1}>
            <summary>Meter History ({measurementHistory.length})</summary>
            <div>
              {measurementHistory.slice(0, 5).map((entry, index) => (
                <p key={`${entry.checkedAt}-${index}`}>
                  <span>{formatClock(entry.checkedAt)}</span>
                  <span>{entry.startTime.toFixed(1)}-{entry.endTime.toFixed(1)}s</span>
                  <span>{entry.measurement.integratedLufs?.toFixed(1) ?? 'n/a'} LUFS</span>
                  <span>{entry.measurement.truePeakDbtp?.toFixed(1) ?? 'n/a'} dBTP</span>
                </p>
              ))}
            </div>
          </details>
        )}
        {warnings.length > 0 && (
          <div className="audio-mixer-warning-list">
            {warnings.slice(0, 4).map((warning) => (
              <p key={warning.code} className={warning.severity}>{warning.message}</p>
            ))}
            {warnings.length > 4 && <p>{warnings.length - 4} more warnings</p>}
          </div>
        )}
      </div>

      <details className="audio-mixer-section" open={(masterAudio.effectStack?.length ?? 0) > 0}>
        <summary>Master FX {(masterAudio.effectStack?.length ?? 0) > 0 ? `(${masterAudio.effectStack?.length})` : ''}</summary>
        <AudioEffectStackControl
          title="Master FX"
          className="audio-effect-stack-compact audio-mixer-fx-stack"
          effects={masterAudio.effectStack ?? []}
          runtimeDynamics={meter?.dynamics}
          emptyLabel="No master FX"
          onAddEffect={(descriptorId) => useTimelineStore.getState().addMasterAudioEffectInstance(descriptorId)}
          onUpdateEffect={(effect, paramName, value) => useTimelineStore.getState().updateMasterAudioEffectInstance(effect.id, { [paramName]: value })}
          onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setMasterAudioEffectInstanceEnabled(effectId, enabled)}
          onRemoveEffect={(effectId) => useTimelineStore.getState().removeMasterAudioEffectInstance(effectId)}
          onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderMasterAudioEffectInstance(effectId, newIndex)}
        />
      </details>
    </section>
  );
}

export function AudioMixerPanel() {
  const tracks = useTimelineStore(state => state.tracks);
  const duration = useTimelineStore(state => state.duration);
  const inPoint = useTimelineStore(state => state.inPoint);
  const outPoint = useTimelineStore(state => state.outPoint);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const runAudioExportPreflight = useTimelineStore(state => state.runAudioExportPreflight);
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [preflightMeasuring, setPreflightMeasuring] = useState(false);

  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  const audioTracks = useMemo(
    () => tracks.filter(track => track.type === 'audio'),
    [tracks],
  );
  const armedAudioTracks = useMemo(
    () => audioTracks.filter(track => track.audioState?.recordArm === true),
    [audioTracks],
  );
  const masterAudio = masterAudioState ?? DEFAULT_MASTER_AUDIO_STATE;
  const recoveryEntries = recordingState.recoveryEntries ?? audioRecordingService.listRecoveryEntries();
  const isRecording = isAudioRecordingActivePhase(recordingState.phase);
  const recordingStorageWarnings = recordingState.storageWarnings ?? [];
  const recordingStorageWarning = recordingStorageWarnings.find(warning => warning.severity === 'warning')
    ?? recordingStorageWarnings[0];
  const recordingRange = useMemo(() => resolveTimelineRecordingRange({
    playheadPosition,
    inPoint,
    outPoint,
    duration,
  }), [duration, inPoint, outPoint, playheadPosition]);
  const recordingElapsed = recordingState.startedAt
    ? Math.max(0, ((recordingState.phase === 'recording' ? Date.now() : (recordingState.lastCompletedAt ?? Date.now())) - recordingState.startedAt) / 1000)
    : 0;

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

  const handleRecordToggle = useCallback(async () => {
    if (recordingBusy) return;
    setRecordingBusy(true);
    try {
      await toggleTimelineAudioRecording({
        isRecording,
        armedAudioTracks,
        playheadPosition,
        inPoint,
        outPoint,
        duration,
        noArmedTrackCode: 'audio-recording-no-armed-track',
        failureCode: 'audio-recording-failed',
      });
    } finally {
      setRecordingBusy(false);
    }
  }, [armedAudioTracks, duration, inPoint, isRecording, outPoint, playheadPosition, recordingBusy]);

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

  const activeSends = audioTracks.reduce((count, track) => (
    count + (track.audioState?.sends?.filter(send => send.enabled !== false).length ?? 0)
  ), 0);
  const activeFx = audioTracks.reduce((count, track) => (
    count + (track.audioState?.effectStack?.filter(effect => effect.enabled !== false).length ?? 0)
  ), masterAudio.effectStack?.filter(effect => effect.enabled !== false).length ?? 0);
  const preflightStatus = getPreflightStatus(masterAudio.exportPreflight);
  const recordButtonTitle = isRecording
    ? `Stop audio recording${recordingElapsed > 0 ? ` (${formatSeconds(recordingElapsed)})` : ''}`
    : armedAudioTracks.length > 0
      ? recordingRange.punchOutTime !== undefined
        ? `Punch record ${formatSeconds(recordingRange.startTime)} to ${formatSeconds(recordingRange.punchOutTime)}`
        : `Record ${armedAudioTracks.length} armed track${armedAudioTracks.length === 1 ? '' : 's'} from ${formatSeconds(recordingRange.startTime)}`
      : 'Arm an audio track before recording';

  return (
    <div className="audio-mixer-panel">
      <header className="audio-mixer-header">
        <div>
          <h3>Audio Mixer</h3>
          <span>
            {audioTracks.length} tracks / {activeSends} sends / {activeFx} FX
          </span>
        </div>
        <div className="audio-mixer-header-actions">
          <span className={`audio-mixer-status ${preflightStatus.className}`}>{preflightStatus.label}</span>
          {recoveryEntries.length > 0 && (
            <span className="audio-mixer-status warning">{recoveryEntries.length} recovery</span>
          )}
          {recordingStorageWarning && (
            <span
              className={`audio-mixer-status ${recordingStorageWarning.severity === 'warning' ? 'warning' : ''}`}
              title={recordingStorageWarning.message}
            >
              Storage
            </span>
          )}
          <button
            type="button"
            className={`audio-mixer-record ${isRecording ? 'recording' : ''} ${armedAudioTracks.length > 0 ? 'armed' : ''}`}
            onClick={handleRecordToggle}
            disabled={recordingBusy || (!isRecording && armedAudioTracks.length === 0)}
            title={recordButtonTitle}
          >
            {isRecording ? 'Stop' : 'Record'}
          </button>
        </div>
      </header>

      <div className="audio-mixer-recording-state">
        <span>{getRecordingLabel(recordingState.phase)}</span>
        {recordingState.punchInTime !== undefined && (
          <span>Punch {formatSeconds(recordingState.punchInTime)}{recordingState.punchOutTime !== undefined ? `-${formatSeconds(recordingState.punchOutTime)}` : ''}</span>
        )}
        {recordingElapsed > 0 && <strong>{formatSeconds(recordingElapsed)}</strong>}
        {recordingState.lastError && <em>{recordingState.lastError}</em>}
        {recordingStorageWarning && (
          <em className={`storage ${recordingStorageWarning.severity}`}>
            {recordingStorageWarning.message}
          </em>
        )}
      </div>

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

      <div className="audio-mixer-strip-grid">
        {audioTracks.map(track => (
          <TrackMixerStrip
            key={track.id}
            track={track}
          />
        ))}
        <MasterMixerStrip
          masterAudio={masterAudio}
          preflightMeasuring={preflightMeasuring}
          onStaticPreflight={handleStaticPreflight}
          onRenderedPreflight={handleRenderedPreflight}
        />
      </div>
    </div>
  );
}
