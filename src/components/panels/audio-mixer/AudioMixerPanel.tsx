import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import './AudioMixerPanel.css';
import './wood-theme/wood-theme.css';
import { useTimelineStore } from '../../../stores/timeline';
import { useSettingsStore } from '../../../stores/settingsStore';
import { AudioExportPipeline } from '../../../engine/audio/AudioExportPipeline';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { collectAudioEqInstances, type AudioEqInstanceDescriptor } from '../../../engine/audio';
import { AudioEqualizerInstanceList } from '../properties/AudioEqualizerInstanceList';
import { DEFAULT_MASTER_AUDIO_STATE, formatSeconds, MASTER_FOCUS_ID } from './audioMixerMath';
import type { FxWindowTarget, TrackColorMenuTarget } from './audioMixerTypes';
import { MasterMixerStrip } from './MasterMixerStrip';
import { MixerFxWindow } from './MixerFxWindow';
import { MixerTrackColorMenu } from './MixerTrackColorMenu';
import { TrackMixerStrip } from './TrackMixerStrip';

export function AudioMixerPanel() {
  const tracks = useTimelineStore(state => state.tracks);
  const clips = useTimelineStore(state => state.clips);
  const selectClip = useTimelineStore(state => state.selectClip);
  const duration = useTimelineStore(state => state.duration);
  const inPoint = useTimelineStore(state => state.inPoint);
  const outPoint = useTimelineStore(state => state.outPoint);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const runAudioExportPreflight = useTimelineStore(state => state.runAudioExportPreflight);
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  const [preflightMeasuring, setPreflightMeasuring] = useState(false);
  const [focusedStripId, setFocusedStripId] = useState<string>(MASTER_FOCUS_ID);
  const [fxWindowTarget, setFxWindowTarget] = useState<FxWindowTarget | null>(null);
  const [trackColorMenuTarget, setTrackColorMenuTarget] = useState<TrackColorMenuTarget | null>(null);
  const woodMixerEnabled = useSettingsStore(state => state.audioMixerWoodThemeEnabled);

  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  // MIDI tracks appear as mixer channel strips too (issue #182): their synth is
  // routed through a per-track volume/pan/meter bus, so they behave like audio.
  const audioTracks = useMemo(
    () => tracks.filter(track => track.type === 'audio' || track.type === 'midi'),
    [tracks],
  );
  useEffect(() => {
    const hasFocusedTrack = audioTracks.some(track => track.id === focusedStripId);
    if (focusedStripId !== MASTER_FOCUS_ID && !hasFocusedTrack) {
      setFocusedStripId(audioTracks[0]?.id ?? MASTER_FOCUS_ID);
    }
  }, [audioTracks, focusedStripId]);

  useEffect(() => {
    if (propertiesSelection?.kind === 'track') {
      if (audioTracks.some(track => track.id === propertiesSelection.trackId)) {
        setFocusedStripId(propertiesSelection.trackId);
      }
      return;
    }
    if (propertiesSelection?.kind === 'master') {
      setFocusedStripId(MASTER_FOCUS_ID);
    }
  }, [audioTracks, propertiesSelection]);

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
    } else if (instance.scope === 'track') {
      setFocusedStripId(instance.ownerId);
      useTimelineStore.getState().selectTrackProperties(instance.ownerId);
    } else if (instance.scope === 'master') {
      setFocusedStripId(MASTER_FOCUS_ID);
      useTimelineStore.getState().selectMasterProperties();
    }
  }, [selectClip]);

  const handleFocusTrack = useCallback((trackId: string) => {
    setFocusedStripId(trackId);
    useTimelineStore.getState().selectTrackProperties(trackId);
  }, []);

  const handleFocusMaster = useCallback(() => {
    setFocusedStripId(MASTER_FOCUS_ID);
    useTimelineStore.getState().selectMasterProperties();
  }, []);

  const handleOpenTrackColorMenu = useCallback((event: ReactMouseEvent, trackId: string) => {
    event.preventDefault();
    event.stopPropagation();
    handleFocusTrack(trackId);
    setTrackColorMenuTarget({
      x: event.clientX,
      y: event.clientY,
      trackId,
    });
  }, [handleFocusTrack]);

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
    <div className={`audio-mixer-panel${woodMixerEnabled ? ' wood' : ''}`}>
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
                  onFocus={() => handleFocusTrack(track.id)}
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
              onFocus={handleFocusMaster}
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
