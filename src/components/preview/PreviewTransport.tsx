import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronDown,
  IconFlag3Filled,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPlayerStopFilled,
  IconPlayerTrackNextFilled,
  IconPlayerTrackPrevFilled,
  IconRepeat,
  IconVolume2,
  IconVolumeOff,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, type PointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { PreviewQuality } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { formatTimelineTimecode } from '../timeline/utils/timelineGrid';
import { usePreviewDockPanelId } from './PreviewDockPanelContext';
import { usePreviewTransportPortal } from './PreviewTransportPortalContext';
import './PreviewTransport.css';

const PREVIEW_FRAME_RATE = 30;
const MUTED_MASTER_VOLUME_DB = -60;

interface PreviewTransportProps {
  playbackControlsVisible: boolean;
  onTogglePlaybackControls: () => void;
  onToggleSceneObjectOverlay: () => void;
  onToggleTransparency: () => void;
  previewQuality: PreviewQuality;
  sceneObjectOverlayEnabled: boolean;
  sourceMonitorActive?: boolean;
  setPreviewQuality: (quality: PreviewQuality) => void;
  showTransparencyGrid: boolean;
}

export function PreviewTransport({
  playbackControlsVisible,
  onTogglePlaybackControls,
  onToggleTransparency,
  previewQuality,
  sceneObjectOverlayEnabled,
  sourceMonitorActive = false,
  setPreviewQuality,
  showTransparencyGrid,
}: PreviewTransportProps) {
  const dockPanelId = usePreviewDockPanelId();
  const { setSourceControlsTarget } = usePreviewTransportPortal();
  const maximizedPanelId = useDockStore(state => state.maximizedPanelId);
  const setMaximizedPanel = useDockStore(state => state.setMaximizedPanel);
  const isPanelMaximized = dockPanelId !== null && maximizedPanelId === dockPanelId;
  const {
    clips,
    duration,
    inPoint,
    isPlaying,
    loopPlayback,
    outPoint,
    pause,
    play,
    playheadPosition,
    setDraggingPlayhead,
    setInPoint,
    setPlayheadPosition,
    setMasterAudioVolumeDb,
    setInPointAtPlayhead,
    setOutPoint,
    setOutPointAtPlayhead,
    stop,
    toggleLoopPlayback,
    tracks,
    masterAudioVolumeDb,
  } = useTimelineStore(useShallow(state => ({
    clips: state.clips,
    duration: state.duration,
    inPoint: state.inPoint,
    isPlaying: state.isPlaying,
    loopPlayback: state.loopPlayback,
    outPoint: state.outPoint,
    pause: state.pause,
    play: state.play,
    playheadPosition: state.playheadPosition,
    setDraggingPlayhead: state.setDraggingPlayhead,
    setInPoint: state.setInPoint,
    setPlayheadPosition: state.setPlayheadPosition,
    setMasterAudioVolumeDb: state.setMasterAudioVolumeDb,
    setInPointAtPlayhead: state.setInPointAtPlayhead,
    setOutPoint: state.setOutPoint,
    setOutPointAtPlayhead: state.setOutPointAtPlayhead,
    stop: state.stop,
    toggleLoopPlayback: state.toggleLoopPlayback,
    tracks: state.tracks,
    masterAudioVolumeDb: state.masterAudioState?.volumeDb ?? 0,
  })));
  const previousMasterVolumeDb = useRef(masterAudioVolumeDb > MUTED_MASTER_VOLUME_DB
    ? masterAudioVolumeDb
    : 0);
  const activeScrubPointerId = useRef<number | null>(null);

  useEffect(() => () => {
    activeScrubPointerId.current = null;
    setDraggingPlayhead(false);
  }, [setDraggingPlayhead]);

  const safeDuration = Math.max(0, duration);
  const videoTrackIds = useMemo(
    () => new Set(tracks.filter(track => track.type === 'video').map(track => track.id)),
    [tracks],
  );
  const editPoints = useMemo(() => Array.from(new Set(
    clips
      .filter(clip => videoTrackIds.has(clip.trackId))
      .flatMap(clip => [clip.startTime, clip.startTime + clip.duration])
      .filter(time => time >= 0 && time <= safeDuration),
  )).toSorted((left, right) => left - right), [clips, safeDuration, videoTrackIds]);

  const seek = (position: number) => {
    setPlayheadPosition(Math.max(0, Math.min(safeDuration, position)));
  };
  const beginScrub = (event: PointerEvent<HTMLInputElement>) => {
    if (event.button !== 0) return;
    activeScrubPointerId.current = event.pointerId;
    setDraggingPlayhead(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const endScrub = (event: PointerEvent<HTMLInputElement>) => {
    if (activeScrubPointerId.current !== event.pointerId) return;
    activeScrubPointerId.current = null;
    setDraggingPlayhead(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const seekPreviousEdit = () => {
    seek(editPoints.findLast(time => time < playheadPosition - 0.001) ?? 0);
  };
  const seekNextEdit = () => {
    seek(editPoints.find(time => time > playheadPosition + 0.001) ?? safeDuration);
  };
  const stepFrame = (direction: -1 | 1) => {
    if (isPlaying) pause();
    seek(playheadPosition + direction / PREVIEW_FRAME_RATE);
  };
  const toggleInPoint = () => {
    if (inPoint !== null) {
      setInPoint(null);
      return;
    }
    setInPointAtPlayhead();
  };
  const toggleOutPoint = () => {
    if (outPoint !== null) {
      setOutPoint(null);
      return;
    }
    setOutPointAtPlayhead();
  };
  const masterAudioMuted = masterAudioVolumeDb <= MUTED_MASTER_VOLUME_DB;
  const toggleMasterAudio = () => {
    if (masterAudioMuted) {
      setMasterAudioVolumeDb(previousMasterVolumeDb.current);
      return;
    }
    previousMasterVolumeDb.current = masterAudioVolumeDb;
    setMasterAudioVolumeDb(MUTED_MASTER_VOLUME_DB);
  };
  const formattedTimecode = formatTimelineTimecode(playheadPosition, PREVIEW_FRAME_RATE);
  const resolveStyleTimecode = formattedTimecode.split(':').length === 3
    ? `00:${formattedTimecode}`
    : formattedTimecode;

  return (
    <div
      className={`preview-transport ${playbackControlsVisible ? 'expanded' : 'collapsed'}`}
      aria-label={sourceMonitorActive ? 'Source playback controls' : 'Preview playback controls'}
    >
      <div className="preview-transport-viewer-tools">
        {!sourceMonitorActive && sceneObjectOverlayEnabled && (
          <button
            aria-label="Toggle transparency grid"
            aria-pressed={showTransparencyGrid}
            className={showTransparencyGrid ? 'active' : undefined}
            onClick={onToggleTransparency}
            title="Transparency grid"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M1 1h4v4H1zm8 0h4v4H9zM5 5h4v4H5zm8 0h2v4h-2zM1 9h4v4H1zm8 0h4v4H9zM5 13h4v2H5zm8 0h2v2h-2z" />
            </svg>
          </button>
        )}
        {!sourceMonitorActive && sceneObjectOverlayEnabled && (
          <label className="preview-transport-quality" title="Preview quality">
            <span className="preview-transport-quality-text">
              {previewQuality === 1 ? 'Full' : previewQuality === 0.5 ? 'Half' : 'Quarter'}
            </span>
            <select
              aria-label="Preview quality"
              onChange={event => setPreviewQuality(Number(event.target.value) as PreviewQuality)}
              value={previewQuality}
            >
              <option value={1}>Full</option>
              <option value={0.5}>Half</option>
              <option value={0.25}>Quarter</option>
            </select>
            <IconChevronDown aria-hidden="true" />
          </label>
        )}
        {(sourceMonitorActive || sceneObjectOverlayEnabled) && (
          <button
            aria-label={playbackControlsVisible ? 'Hide playback controls' : 'Show playback controls'}
            aria-pressed={playbackControlsVisible}
            className={playbackControlsVisible ? 'active' : undefined}
            onClick={onTogglePlaybackControls}
            title={playbackControlsVisible ? 'Hide playback controls' : 'Show playback controls'}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="M3 4.5h14v11H3z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.8 12.2h12.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="m8.2 7 4 2-4 2z" />
            </svg>
          </button>
        )}
        {!sourceMonitorActive && sceneObjectOverlayEnabled && (
          <button
            aria-label={masterAudioMuted ? 'Unmute all audio' : 'Mute all audio'}
            aria-pressed={masterAudioMuted}
            className={masterAudioMuted ? 'active' : undefined}
            onClick={toggleMasterAudio}
            title={masterAudioMuted ? 'Unmute all audio' : 'Mute all audio'}
            type="button"
          >
            {masterAudioMuted
              ? <IconVolumeOff aria-hidden="true" />
              : <IconVolume2 aria-hidden="true" />}
          </button>
        )}
        {(sourceMonitorActive || sceneObjectOverlayEnabled) && dockPanelId && (
          <button
            aria-label={isPanelMaximized ? 'Restore preview panel' : 'Maximize preview panel'}
            aria-pressed={isPanelMaximized}
            className={`preview-transport-maximize${isPanelMaximized ? ' active' : ''}`}
            data-dock-tab-swipe-ignore="true"
            onClick={() => setMaximizedPanel(isPanelMaximized ? null : dockPanelId)}
            title={isPanelMaximized ? 'Restore preview panel' : 'Maximize preview panel'}
            type="button"
          >
            {isPanelMaximized
              ? <IconArrowsMinimize aria-hidden="true" />
              : <IconArrowsMaximize aria-hidden="true" />}
          </button>
        )}
      </div>

      <div
        className="preview-transport-panel"
        aria-hidden={!playbackControlsVisible}
        inert={!playbackControlsVisible}
      >
        {sourceMonitorActive ? (
          <div
            ref={setSourceControlsTarget}
            className="preview-source-transport-slot"
          />
        ) : (
          <>
            <input
              aria-label="Preview playhead"
              className="preview-transport-scrubber"
              max={safeDuration || 1}
              min={0}
              onChange={event => seek(Number(event.target.value))}
              onLostPointerCapture={endScrub}
              onPointerCancel={endScrub}
              onPointerDown={beginScrub}
              onPointerUp={endScrub}
              step={1 / PREVIEW_FRAME_RATE}
              tabIndex={playbackControlsVisible ? 0 : -1}
              type="range"
              value={Math.min(playheadPosition, safeDuration || 1)}
            />

            <div className="preview-transport-row">
              <div className="preview-transport-buttons">
                <button
                  aria-label={inPoint !== null ? 'Clear In point' : 'Set In point at playhead'}
                  aria-pressed={inPoint !== null}
                  className={`preview-transport-mark${inPoint !== null ? ' active' : ''}`}
                  onClick={toggleInPoint}
                  title={inPoint !== null ? 'Clear In point' : 'Set In point at playhead [I]'}
                  type="button"
                >
                  <IconFlag3Filled className="preview-transport-flag in-flag" aria-hidden="true" />
                </button>
                <button aria-label="Previous edit" onClick={seekPreviousEdit} title="Previous edit" type="button">
                  <IconPlayerTrackPrevFilled aria-hidden="true" />
                </button>
                <button aria-label="Previous frame" onClick={() => stepFrame(-1)} title="Previous frame" type="button">
                  <IconPlayerSkipBackFilled aria-hidden="true" />
                </button>
                <button aria-label="Stop" onClick={stop} title="Stop" type="button">
                  <IconPlayerStopFilled aria-hidden="true" />
                </button>
                <button
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  aria-pressed={isPlaying}
                  className={isPlaying ? 'active' : undefined}
                  onClick={() => (isPlaying ? pause() : void play())}
                  title={isPlaying ? 'Pause' : 'Play'}
                  type="button"
                >
                  {isPlaying
                    ? <IconPlayerPauseFilled aria-hidden="true" />
                    : <IconPlayerPlayFilled aria-hidden="true" />}
                </button>
                <button aria-label="Next frame" onClick={() => stepFrame(1)} title="Next frame" type="button">
                  <IconPlayerSkipForwardFilled aria-hidden="true" />
                </button>
                <button aria-label="Next edit" onClick={seekNextEdit} title="Next edit" type="button">
                  <IconPlayerTrackNextFilled aria-hidden="true" />
                </button>
                <button
                  aria-label={outPoint !== null ? 'Clear Out point' : 'Set Out point at playhead'}
                  aria-pressed={outPoint !== null}
                  className={`preview-transport-mark${outPoint !== null ? ' active' : ''}`}
                  onClick={toggleOutPoint}
                  title={outPoint !== null ? 'Clear Out point' : 'Set Out point at playhead [O]'}
                  type="button"
                >
                  <IconFlag3Filled className="preview-transport-flag out-flag" aria-hidden="true" />
                </button>
                <button
                  aria-label={loopPlayback ? 'Disable loop' : 'Enable loop'}
                  aria-pressed={loopPlayback}
                  className={loopPlayback ? 'active' : undefined}
                  onClick={toggleLoopPlayback}
                  title={loopPlayback ? 'Loop on' : 'Loop off'}
                  type="button"
                >
                  <IconRepeat aria-hidden="true" />
                </button>
              </div>

              <output>{resolveStyleTimecode}</output>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
