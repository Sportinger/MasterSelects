// TimelineControls component - Playback controls and toolbar

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import './TimelineControls.css';
import type { TimelineControlsProps } from './types';
import { useSettingsStore } from '../../stores/settingsStore';
import { engine } from '../../engine/WebGPUEngine';
import { layerBuilder } from '../../services/layerBuilder';

function TimelineControlsComponent({
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
  toolMode,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onSetZoom,
  onToggleSnapping,
  onSetInPoint,
  onSetOutPoint,
  onClearInOut,
  onToggleProxy,
  onToggleTranscriptMarkers,
  onToggleThumbnails,
  onToggleWaveforms,
  onToggleCutTool,
  onSetDuration,
  onFitToWindow,
  onToggleSlotGrid,
  slotGridActive,
  formatTime,
  parseTime,
}: TimelineControlsProps) {
  const [isEditingDuration, setIsEditingDuration] = useState(false);
  const [durationInputValue, setDurationInputValue] = useState('');
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const durationInputRef = useRef<HTMLInputElement>(null);
  const viewDropdownRef = useRef<HTMLDivElement>(null);
  const proxyTitle = proxyEnabled
    ? 'Proxy ON - Click to disable proxy playback'
    : currentlyGeneratingProxyId
    ? 'Proxy OFF - Proxy generation is running. Click to enable proxy playback'
    : 'Proxy OFF - Click to enable proxy playback and proxy generation';

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingDuration && durationInputRef.current) {
      durationInputRef.current.focus();
      durationInputRef.current.select();
    }
  }, [isEditingDuration]);

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

  const handleDurationClick = () => {
    setDurationInputValue(formatTime(duration));
    setIsEditingDuration(true);
  };

  const handleDurationSubmit = () => {
    const newDuration = parseTime(durationInputValue);
    if (newDuration !== null && newDuration > 0) {
      onSetDuration(newDuration);
    }
    setIsEditingDuration(false);
  };

  const handleDurationKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleDurationSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingDuration(false);
    }
  };

  const handleDurationBlur = () => {
    handleDurationSubmit();
  };
  return (
    <div className="timeline-toolbar">
      <div className="timeline-slot-toggle">
        <button
          className={`btn btn-sm btn-icon ${slotGridActive ? 'btn-active' : ''}`}
          onClick={onToggleSlotGrid}
          title={slotGridActive ? 'Back to Timeline (Ctrl+Shift+Scroll)' : 'Slot Grid View (Ctrl+Shift+Scroll)'}
        >
          {slotGridActive
            ? <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="14" height="2" rx="0.5"/></svg>
            : <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
          }
        </button>
      </div>
      <div className="timeline-controls">
        <button className="btn btn-sm" onClick={onStop} title="Stop">
          {'\u23F9'}
        </button>
        <button
          className={`btn btn-sm ${isPlaying ? 'btn-active' : ''}`}
          onClick={isPlaying ? onPause : onPlay}
          data-tutorial-id="play-btn"
        >
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button
          className={`btn btn-sm ${loopPlayback ? 'btn-active' : ''}`}
          onClick={onToggleLoop}
          title={loopPlayback ? 'Loop On (L)' : 'Loop Off (L)'}
        >
          {'\uD83D\uDD01'}
        </button>
      </div>
      <div className="timeline-time">
        {formatTime(playheadPosition)} /{' '}
        {isEditingDuration ? (
          <input
            ref={durationInputRef}
            type="text"
            className="duration-input"
            value={durationInputValue}
            onChange={(e) => setDurationInputValue(e.target.value)}
            onKeyDown={handleDurationKeyDown}
            onBlur={handleDurationBlur}
          />
        ) : (
          <span
            className="duration-display"
            onClick={handleDurationClick}
            title="Click to edit composition duration"
          >
            {formatTime(duration)}
          </span>
        )}
      </div>
      <div className="timeline-zoom">
        <button
          className={`btn btn-sm btn-icon ${snappingEnabled ? 'btn-active' : ''}`}
          onClick={onToggleSnapping}
          title={snappingEnabled ? 'Snapping enabled - clips snap to edges' : 'Snapping disabled - free positioning'}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L12 6M12 18L12 22M2 12L6 12M18 12L22 12" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          className={`btn btn-sm btn-icon ${toolMode === 'cut' ? 'btn-active' : ''}`}
          onClick={onToggleCutTool}
          title={toolMode === 'cut' ? 'Cut Tool active (C) - click clips to split' : 'Cut Tool (C) - click to activate'}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
          </svg>
        </button>
        <button className="btn btn-sm" onClick={() => onSetZoom(zoom - 10)} title="Zoom out">
          {'\u2212'}
        </button>
        <button className="btn btn-sm" onClick={() => onSetZoom(zoom + 10)} title="Zoom in">
          +
        </button>
        <button className="btn btn-sm" onClick={onFitToWindow} title="Fit composition to window">
          Fit
        </button>
      </div>
      <div className="timeline-inout-controls">
        <button
          className={`btn btn-sm ${inPoint !== null ? 'btn-active' : ''}`}
          onClick={onSetInPoint}
          title="Set In point (I)"
        >
          I
        </button>
        <button
          className={`btn btn-sm ${outPoint !== null ? 'btn-active' : ''}`}
          onClick={onSetOutPoint}
          title="Set Out point (O)"
        >
          O
        </button>
        {(inPoint !== null || outPoint !== null) && (
          <button
            className="btn btn-sm"
            onClick={onClearInOut}
            title="Clear In/Out (X)"
          >
            X
          </button>
        )}
      </div>
      <div className="timeline-ram-preview">
        <button
          className={`btn btn-sm ${proxyEnabled ? 'btn-active' : ''}`}
          onClick={onToggleProxy}
          title={proxyTitle}
        >
          Proxy
        </button>
        <WebCodecsToggle />
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
      </div>
    </div>
  );
}

function WebCodecsToggle() {
  const enabled = useSettingsStore((s) => s.webCodecsEnabled);
  const setWebCodecsEnabled = useSettingsStore((s) => s.setWebCodecsEnabled);

  const toggle = useCallback(() => {
    setWebCodecsEnabled(!enabled);
    layerBuilder.invalidateCache();
    engine.requestRender();
  }, [enabled, setWebCodecsEnabled]);

  return (
    <button
      className={`btn btn-sm ${enabled ? 'btn-active' : ''}`}
      onClick={toggle}
      title={enabled ? 'WebCodecs mode active (click to switch to HTML Video)' : 'HTML Video mode active (click to switch to WebCodecs)'}
    >
      {enabled ? 'WC' : 'HTML'}
    </button>
  );
}

export const TimelineControls = memo(TimelineControlsComponent);
