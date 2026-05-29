// TimelineControls component - Playback controls and toolbar

import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  IconArrowsMaximize,
  IconLayoutGrid,
  IconList,
  IconMagnet,
  IconMinus,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerRecordFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconRepeat,
  IconTools,
} from '@tabler/icons-react';
import './TimelineControls.css';
import type { TimelineControlsProps } from './types';
import { useTimelineStore } from '../../stores/timeline';
import { AudioEffectStackControl } from '../panels/properties/AudioEffectStackControl';
import { AudioLevelMeter } from './components/AudioLevelMeter';
import { TimelineToolPalette } from './tools/TimelineToolPalette';
import { AudioExportPipeline } from '../../engine/audio/AudioExportPipeline';
import { audioRecordingService } from '../../services/audio/AudioRecordingService';
import {
  isAudioRecordingActivePhase,
  resolveTimelineRecordingRange,
  toggleTimelineAudioRecording,
} from '../../services/audio/timelineRecordingWorkflow';

function TimelineControlsComponent({
  variant = 'full',
  isPlaying,
  loopPlayback,
  playheadPosition,
  duration,
  zoom,
  snappingEnabled,
  inPoint,
  outPoint,
  proxyEnabled,
  currentlyGeneratingProxyId,
  mediaFilesWithProxy,
  showTranscriptMarkers,
  thumbnailsEnabled,
  waveformsEnabled,
  audioDisplayMode,
  audioFocusMode,
  showAudioRegionEditMarkers,
  trackFocusMode,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onSetZoom,
  onToggleSnapping,
  onToggleProxy,
  onToggleTranscriptMarkers,
  onToggleThumbnails,
  onToggleWaveforms,
  onSetAudioDisplayMode,
  onToggleAudioFocusMode,
  onToggleAudioRegionEditMarkers,
  onSetTrackFocusMode,
  onFitToWindow,
  onToggleSlotGrid,
  slotGridActive,
  formatTime,
}: TimelineControlsProps) {
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [masterDropdownOpen, setMasterDropdownOpen] = useState(false);
  const [preflightMeasuring, setPreflightMeasuring] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const masterDropdownRef = useRef<HTMLDivElement>(null);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const openTimelineToolGroupId = useTimelineStore(state => state.openTimelineToolGroupId);
  const runAudioExportPreflight = useTimelineStore(state => state.runAudioExportPreflight);
  const timelineTracks = useTimelineStore(state => state.tracks);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const armedAudioTracks = useMemo(
    () => timelineTracks.filter(track => track.type === 'audio' && track.audioState?.recordArm === true),
    [timelineTracks],
  );
  const masterAudio = masterAudioState ?? {
    volumeDb: 0,
    limiterEnabled: false,
    truePeakCeilingDb: -1,
    targetLufs: -14,
    effectStack: [],
    exportPreflight: undefined,
  };
  const masterEffectCount = masterAudio.effectStack?.length ?? 0;
  const masterPropertiesSelected = propertiesSelection?.kind === 'master';
  const preflightWarnings = masterAudio.exportPreflight?.warnings ?? [];
  const preflightMeasurement = masterAudio.exportPreflight?.measurement;
  const preflightIssueCount = preflightWarnings.filter(item => item.severity !== 'info').length;
  const preflightInfoCount = preflightWarnings.length - preflightIssueCount;
  const isRecording = isAudioRecordingActivePhase(recordingState.phase);
  const recoveryEntries = recordingState.recoveryEntries ?? audioRecordingService.listRecoveryEntries();
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
  const proxyTitle = proxyEnabled
    ? 'Proxy ON - Click to disable proxy playback'
    : currentlyGeneratingProxyId
    ? 'Proxy OFF - Proxy generation is running. Click to enable proxy playback'
    : 'Proxy OFF - Click to enable proxy playback and proxy generation';
  const recordButtonTitle = isRecording
    ? `Stop audio recording${recordingElapsed > 0 ? ` (${recordingElapsed.toFixed(1)}s)` : ''}`
    : armedAudioTracks.length > 0
      ? recordingRange.punchOutTime !== undefined
        ? `Punch record ${formatTime(recordingRange.startTime)} to ${formatTime(recordingRange.punchOutTime)}`
        : `Record armed audio track${armedAudioTracks.length === 1 ? '' : 's'} from ${formatTime(recordingRange.startTime)}`
      : 'Arm an audio track before recording';
  const showMainControls = variant !== 'utility';
  const showUtilityControls = variant !== 'main' && variant !== 'transport' && variant !== 'zoom';

  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(e.target as Node)) {
        setViewDropdownOpen(false);
      }
    };
    if (viewDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [viewDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (masterDropdownRef.current && !masterDropdownRef.current.contains(e.target as Node)) {
        setMasterDropdownOpen(false);
      }
    };
    if (masterDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [masterDropdownOpen]);

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
            code: 'audio-export-rendered-preflight-failed',
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

  return (
    <div className={`timeline-toolbar timeline-toolbar-${variant}`}>
      {showMainControls && (
        <>
      <div className="timeline-controls">
        <button className="btn btn-sm btn-icon timeline-transport-button" onClick={onStop} title="Stop">
          <IconPlayerStopFilled className="timeline-transport-icon" aria-hidden="true" />
        </button>
        <button
          className={`btn btn-sm btn-icon timeline-transport-button ${isPlaying ? 'btn-active' : ''}`}
          onClick={isPlaying ? onPause : onPlay}
          data-tutorial-id="play-btn"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <IconPlayerPauseFilled className="timeline-transport-icon" aria-hidden="true" />
          ) : (
            <IconPlayerPlayFilled className="timeline-transport-icon" aria-hidden="true" />
          )}
        </button>
        <button
          className={`btn btn-sm btn-icon timeline-transport-button timeline-loop-button ${loopPlayback ? 'btn-active' : ''}`}
          onClick={onToggleLoop}
          title={loopPlayback ? 'Loop On (L)' : 'Loop Off (L)'}
        >
          <IconRepeat className="timeline-transport-icon timeline-loop-icon" stroke={2.8} aria-hidden="true" />
        </button>
        <button
          className={`btn btn-sm btn-icon timeline-transport-button timeline-record-button ${isRecording ? 'recording' : ''} ${armedAudioTracks.length > 0 ? 'armed' : ''}`}
          onClick={handleRecordToggle}
          disabled={recordingBusy || (!isRecording && armedAudioTracks.length === 0)}
          title={recordButtonTitle}
        >
          <IconPlayerRecordFilled className="timeline-transport-icon" aria-hidden="true" />
        </button>
        <button
          className={`btn btn-sm timeline-proxy-button ${proxyEnabled ? 'btn-active' : ''}`}
          onClick={onToggleProxy}
          title={proxyTitle}
        >
          Proxy
        </button>
        {recoveryEntries.length > 0 && (
          <button
            type="button"
            className="btn btn-sm timeline-record-recovery"
            title={`${recoveryEntries.length} audio recording recovery entr${recoveryEntries.length === 1 ? 'y' : 'ies'}`}
            onClick={() => setMasterDropdownOpen(true)}
          >
            {recoveryEntries.length}
          </button>
        )}
        {recordingStorageWarning && (
          <span
            className={`timeline-record-storage ${recordingStorageWarning.severity}`}
            title={recordingStorageWarning.message}
          >
            !
          </span>
        )}
      </div>
      <div className={`timeline-edit-tools ${openTimelineToolGroupId ? 'timeline-edit-tools-open' : ''}`}>
        <span className="timeline-edit-tools-hub" aria-hidden="true">
          <IconTools className="timeline-edit-tools-hub-icon" size={18} stroke={2.15} />
        </span>
        <div className="timeline-edit-tools-items">
          <TimelineToolPalette />
          <button
            type="button"
            className={`timeline-tool-button timeline-snapping-button ${snappingEnabled ? 'active' : ''}`}
            aria-label="Snapping"
            aria-pressed={snappingEnabled}
            onPointerUp={(event) => {
              if (event.button !== 0) return;
              onToggleSnapping();
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onToggleSnapping();
            }}
            title={snappingEnabled ? 'Snapping enabled - clips snap to edges' : 'Snapping disabled - free positioning'}
          >
            <IconMagnet className="timeline-tool-button-icon" size={18} stroke={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
        </>
      )}
      {showUtilityControls && (
        <>
      <div className="timeline-master-audio" ref={masterDropdownRef}>
        <button
          className={`btn btn-sm ${masterPropertiesSelected || masterDropdownOpen || masterEffectCount > 0 || masterAudio.limiterEnabled ? 'btn-active' : ''} ${preflightIssueCount > 0 ? 'audio-preflight-alert' : ''}`}
          onClick={() => {
            useTimelineStore.getState().selectMasterProperties();
            setMasterDropdownOpen(open => !open);
          }}
          title="Master audio bus"
        >
          Master {masterAudio.volumeDb.toFixed(1)} dB
        </button>
        <AudioLevelMeter streamScope={{ kind: 'master' }} streamFeatures={['level', 'phase']} label="Master level" className="timeline-master-audio-meter" />
        {masterDropdownOpen && (
          <div
            className="timeline-master-audio-popover"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="timeline-master-audio-grid">
              <label>
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
              <label>
                <span>Limiter</span>
                <input
                  type="checkbox"
                  checked={masterAudio.limiterEnabled}
                  onChange={(event) => useTimelineStore.getState().setMasterLimiterEnabled(event.currentTarget.checked)}
                />
              </label>
              <label>
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
              <label>
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
            </div>
            <AudioEffectStackControl
              title="Master FX"
              className="audio-effect-stack-compact"
              effects={masterAudio.effectStack ?? []}
              runtimeAnalyzerScope="master"
              emptyLabel="No master FX"
              onAddEffect={(descriptorId) => useTimelineStore.getState().addMasterAudioEffectInstance(descriptorId)}
              onUpdateEffect={(effect, paramName, value) => useTimelineStore.getState().updateMasterAudioEffectInstance(effect.id, { [paramName]: value })}
              onSetEffectEnabled={(effectId, enabled) => useTimelineStore.getState().setMasterAudioEffectInstanceEnabled(effectId, enabled)}
              onRemoveEffect={(effectId) => useTimelineStore.getState().removeMasterAudioEffectInstance(effectId)}
              onReorderEffect={(effectId, newIndex) => useTimelineStore.getState().reorderMasterAudioEffectInstance(effectId, newIndex)}
            />
            <div className="timeline-master-preflight">
              <div className="timeline-master-preflight-header">
                <span>Export Preflight</span>
                <div className="timeline-master-preflight-actions">
                  <button
                    className="btn btn-sm"
                    onClick={handleStaticPreflight}
                  >
                    Check
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={handleRenderedPreflight}
                    disabled={preflightMeasuring}
                  >
                    {preflightMeasuring ? 'Measuring' : 'Measure'}
                  </button>
                </div>
              </div>
              {preflightMeasurement && (
                <div className="timeline-master-preflight-metrics">
                  <span>LUFS {preflightMeasurement.integratedLufs?.toFixed(1) ?? '-'}</span>
                  <span>TP {preflightMeasurement.truePeakDbtp?.toFixed(1) ?? '-'} dB</span>
                  <span>Peak {preflightMeasurement.samplePeakDbfs?.toFixed(1) ?? '-'} dB</span>
                </div>
              )}
              <div className={`timeline-master-preflight-status ${preflightIssueCount > 0 ? 'warning' : 'ok'}`}>
                {preflightIssueCount > 0
                  ? `${preflightIssueCount} issue${preflightIssueCount === 1 ? '' : 's'}`
                  : preflightWarnings.length > 0
                    ? `${preflightInfoCount} info`
                    : 'Ready'}
              </div>
              {preflightWarnings.length > 0 && (
                <div className="timeline-master-preflight-list">
                  {preflightWarnings.slice(0, 5).map((item, index) => (
                    <div key={`${item.code}-${index}`} className={`timeline-master-preflight-item ${item.severity ?? 'warning'}`}>
                      <span>{item.severity ?? 'warning'}</span>
                      <p>{item.message}</p>
                    </div>
                  ))}
                  {preflightWarnings.length > 5 && (
                    <div className="timeline-master-preflight-more">
                      +{preflightWarnings.length - 5} more
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="timeline-ram-preview">
        <div className="view-dropdown" ref={viewDropdownRef}>
          <button
            className={`btn btn-sm ${viewDropdownOpen ? 'btn-active' : ''}`}
            onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
            title="View options"
          >
            View
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 4 }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {viewDropdownOpen && (
            <div className="view-dropdown-menu">
              <div
                className="view-dropdown-item"
                onClick={onToggleProxy}
              >
                <span className={`view-check ${proxyEnabled ? 'checked' : ''}`}>✓</span>
                <span>
                  Proxy
                  {currentlyGeneratingProxyId && ' (Generating...)'}
                  {!currentlyGeneratingProxyId && mediaFilesWithProxy > 0 && ` (${mediaFilesWithProxy})`}
                </span>
              </div>
              <div
                className="view-dropdown-item"
                onClick={onToggleThumbnails}
              >
                <span className={`view-check ${thumbnailsEnabled ? 'checked' : ''}`}>✓</span>
                <span>Thumbnails</span>
              </div>
              <div
                className="view-dropdown-item"
                onClick={onToggleWaveforms}
              >
                <span className={`view-check ${waveformsEnabled ? 'checked' : ''}`}>✓</span>
                <span>Waveforms</span>
              </div>
              <div className="view-dropdown-divider" />
              <div
                className={`view-dropdown-item ${trackFocusMode === 'balanced' ? 'active' : ''}`}
                onClick={() => onSetTrackFocusMode('balanced')}
              >
                <span className={`view-check ${trackFocusMode === 'balanced' ? 'checked' : ''}`}>✓</span>
                <span>Balanced Tracks</span>
              </div>
              <div
                className={`view-dropdown-item ${trackFocusMode === 'audio' ? 'active' : ''}`}
                onClick={onToggleAudioFocusMode}
              >
                <span className={`view-check ${audioFocusMode ? 'checked' : ''}`}>✓</span>
                <span>Audio Focus</span>
              </div>
              <div
                className={`view-dropdown-item ${trackFocusMode === 'video' ? 'active' : ''}`}
                onClick={() => onSetTrackFocusMode('video')}
              >
                <span className={`view-check ${trackFocusMode === 'video' ? 'checked' : ''}`}>✓</span>
                <span>Video Focus</span>
              </div>
              <div className="view-dropdown-divider" />
              <div
                className={`view-dropdown-item ${audioDisplayMode === 'compact' ? 'active' : ''}`}
                onClick={() => onSetAudioDisplayMode('compact')}
              >
                <span className={`view-check ${audioDisplayMode === 'compact' ? 'checked' : ''}`}>✓</span>
                <span>Compact Audio</span>
              </div>
              <div
                className={`view-dropdown-item ${audioDisplayMode === 'detailed' ? 'active' : ''}`}
                onClick={() => onSetAudioDisplayMode('detailed')}
              >
                <span className={`view-check ${audioDisplayMode === 'detailed' ? 'checked' : ''}`}>✓</span>
                <span>Detailed Audio</span>
              </div>
              <div
                className={`view-dropdown-item ${audioDisplayMode === 'spectral' ? 'active' : ''}`}
                onClick={() => onSetAudioDisplayMode('spectral')}
              >
                <span className={`view-check ${audioDisplayMode === 'spectral' ? 'checked' : ''}`}>✓</span>
                <span>Spectral Audio</span>
              </div>
              <div
                className="view-dropdown-item"
                onClick={onToggleAudioRegionEditMarkers}
              >
                <span className={`view-check ${showAudioRegionEditMarkers ? 'checked' : ''}`}>âœ“</span>
                <span>Audio Region Markers</span>
              </div>
              <div
                className="view-dropdown-item"
                onClick={onToggleTranscriptMarkers}
              >
                <span className={`view-check ${showTranscriptMarkers ? 'checked' : ''}`}>✓</span>
                <span>Transcript Markers</span>
              </div>
            </div>
          )}
        </div>
        <div className="timeline-slot-toggle timeline-slot-toggle-view">
          <button
            type="button"
            className={`timeline-tool-button ${slotGridActive ? 'active' : ''}`}
            onClick={onToggleSlotGrid}
            title={slotGridActive ? 'Back to Timeline (Ctrl+Shift+Scroll)' : 'Slot Grid View (Ctrl+Shift+Scroll)'}
            aria-label={slotGridActive ? 'Back to Timeline' : 'Slot Grid View'}
            aria-pressed={slotGridActive}
          >
            {slotGridActive
              ? <IconList className="timeline-tool-button-icon" size={18} stroke={2.2} aria-hidden="true" />
              : <IconLayoutGrid className="timeline-tool-button-icon" size={18} stroke={2.2} aria-hidden="true" />
            }
          </button>
        </div>
      </div>
        </>
      )}
      {showMainControls && (
      <div className="timeline-zoom-controls">
        <button className="btn btn-sm btn-icon timeline-zoom-button" onClick={() => onSetZoom(zoom - 10)} title="Zoom out">
          <IconMinus size={14} stroke={2.4} aria-hidden="true" />
        </button>
        <button className="btn btn-sm btn-icon timeline-zoom-button" onClick={() => onSetZoom(zoom + 10)} title="Zoom in">
          <IconPlus size={14} stroke={2.4} aria-hidden="true" />
        </button>
        <button className="btn btn-sm btn-icon timeline-zoom-button" onClick={onFitToWindow} title="Fit composition to window">
          <IconArrowsMaximize size={14} stroke={2.2} aria-hidden="true" />
        </button>
      </div>
      )}
    </div>
  );
}

export const TimelineControls = memo(TimelineControlsComponent);
