// Multi Preview Panel — 2x2 grid of independent preview slots
// Shared controls: source dropdown, transparency toggle, quality selector, stats overlay
// Source modes: "Custom" (per-slot composition) or a composition (auto-distributes first 4 video layers)

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import { isTextEntryTarget } from '../../services/shortcutFocusPolicy';
import { useEngineStore } from '../../stores/engineStore';
import { useMediaStore } from '../../stores/mediaStore';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import { useSettingsStore, type PreviewQuality } from '../../stores/settingsStore';
import { useDockStore } from '../../stores/dockStore';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { getProgramAngleIndex } from '../../services/multicam/multicamPlan';
import { Logger } from '../../services/logger';
import { StatsOverlay } from './StatsOverlay';
import { MultiPreviewSlot } from './MultiPreviewSlot';
import type { MultiPreviewPanelData } from '../../types/dock';
import './MultiPreview.css';

const log = Logger.create('MultiPreview');

const EXPORT_LOCKED_REASON = 'Editing is locked while the export runs; multicam changes wait until it finishes.';

interface MultiPreviewPanelProps {
  panelId: string;
  data: MultiPreviewPanelData;
}

function MultiPreviewStatsOverlay({
  onOpen,
  resolution,
}: {
  onOpen: () => void;
  resolution: { width: number; height: number };
}) {
  const engineStats = useEngineStore((state) => state.engineStats);
  return (
    <StatsOverlay
      stats={engineStats}
      resolution={resolution}
      expanded={false}
      onToggle={onOpen}
    />
  );
}

export function MultiPreviewPanel({ panelId, data: dockData }: MultiPreviewPanelProps) {
  // The panel's own copy of its layout: a dock panel mirrors it into the dock store, a panel
  // outside the dock (the phone's landscape editor) keeps it here instead of losing every change.
  const [data, setData] = useState(dockData);
  useEffect(() => setData(dockData), [dockData]);
  const [status, setStatus] = useState<string | null>(null);
  const setMulticamActive = useTimelineStore((s) => s.setMulticamActive);
  const switchMulticamAngle = useTimelineStore((s) => s.switchMulticamAngle);
  const compositions = useMediaStore((s) => s.compositions);
  const visibleCompositions = useMemo(() => compositions.filter(isUserVisibleComposition), [compositions]);
  const { previewQuality, setPreviewQuality } = useSettingsStore();
  const updatePanelData = useDockStore((s) => s.updatePanelData);
  const activateStatsPanel = useDockStore((s) => s.activatePanelType);
  const outputResolution = useSettingsStore((s) => s.outputResolution);

  const [qualityOpen, setQualityOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  const [highlightedSlot, setHighlightedSlot] = useState<number | null>(null);

  const sourceComp = useMemo(
    () => visibleCompositions.find((c) => c.id === data.sourceCompositionId),
    [visibleCompositions, data.sourceCompositionId]
  );
  const isAutoMode = sourceComp !== undefined;

  // Multicam cut mode works on the active composition: slots show its cameras,
  // the camera on air at the playhead gets a red frame.
  const activeCompositionId = useMediaStore((s) => s.activeCompositionId);
  const activeMulticam = useMemo(
    () => compositions.find((c) => c.id === activeCompositionId)?.multicam ?? null,
    [compositions, activeCompositionId]
  );
  const multicamOn = Boolean(activeCompositionId && activeMulticam?.active);
  const onAirAngle = useTimelineStore((s) => (
    multicamOn && activeMulticam ? getProgramAngleIndex(activeMulticam, s.clips, s.playheadPosition) : -1
  ));
  // Camera labels follow track renames.
  const angleLabels = useTimelineStore(useShallow((s) => (activeMulticam?.angles ?? []).map((angle) => (
    s.tracks.find((track) => track.id === angle.trackId)?.name ?? angle.label
  ))));

  // Highlight slots on 1/2/3/4 key press (via shortcut registry)
  useEffect(() => {
    const registry = getShortcutRegistry();
    const slotActions = [
      'preview.slot1' as const,
      'preview.slot2' as const,
      'preview.slot3' as const,
      'preview.slot4' as const,
    ];
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target) || isTextEntryTarget(document.activeElement)) return;
      for (let i = 0; i < slotActions.length; i++) {
        if (registry.matches(slotActions[i], e)) {
          setHighlightedSlot(i);
          return;
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      for (let i = 0; i < slotActions.length; i++) {
        if (registry.matches(slotActions[i], e)) {
          setHighlightedSlot((prev) => (prev === i ? null : prev));
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!sourceOpen && !qualityOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sourceOpen && sourceDropdownRef.current && !sourceDropdownRef.current.contains(target)) {
        setSourceOpen(false);
      }
      if (qualityOpen) {
        setQualityOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sourceOpen, qualityOpen]);

  const commitData = useCallback(
    (next: MultiPreviewPanelData) => {
      setData(next);
      updatePanelData(panelId, next);
    },
    [panelId, updatePanelData]
  );

  const handleSourceChange = useCallback(
    (compositionId: string | null) => {
      commitData({ ...data, sourceCompositionId: compositionId });
      setSourceOpen(false);
    },
    [commitData, data]
  );

  const handleSlotCompositionChange = useCallback(
    (slotIndex: number, compositionId: string | null) => {
      const newSlots = [...data.slots] as MultiPreviewPanelData['slots'];
      newSlots[slotIndex] = { compositionId };
      commitData({ ...data, slots: newSlots });
    },
    [commitData, data]
  );

  const toggleTransparency = useCallback(() => {
    commitData({ ...data, showTransparencyGrid: !data.showTransparencyGrid });
  }, [commitData, data]);

  const toggleMulticam = useCallback(() => {
    const enabling = !multicamOn;
    // The export edit lock blocks multicam changes and returns nothing: say that, not a track reason.
    if (useTimelineStore.getState().isExporting) {
      log.warn('Multicam toggle blocked during export', { enabling });
      setStatus(EXPORT_LOCKED_REASON);
      return;
    }
    if (setMulticamActive(enabling)) {
      setStatus(null);
      return;
    }
    const reason = enabling
      ? 'Multicam needs at least two video tracks with camera clips (one camera per track, unlocked).'
      : 'Multicam could not be turned off for this composition.';
    log.warn(enabling ? 'Multicam could not be turned on' : 'Multicam could not be turned off', { reason });
    setStatus(reason);
  }, [multicamOn, setMulticamActive]);

  // Touch: tapping a camera cuts to it at the playhead, like its number key on a keyboard.
  const handleAngleTap = useCallback((angleIndex: number) => {
    const label = `Camera ${angleIndex + 1}`;
    if (angleIndex === onAirAngle) {
      setStatus(`${label} is already on air here.`);
      return;
    }
    if (useTimelineStore.getState().isExporting) {
      log.warn('Multicam cut blocked during export', { angleIndex });
      setStatus(EXPORT_LOCKED_REASON);
      return;
    }
    if (switchMulticamAngle(angleIndex)) {
      setStatus(null);
      return;
    }
    const reason = `${label} has no material at the playhead; the program stays as it is.`;
    log.info('Multicam cut ignored', { angleIndex, reason });
    setStatus(reason);
  }, [onAirAngle, switchMulticamAngle]);

  return (
    <div
      className="multi-preview-container"
      onPointerUp={(event) => {
        // Pointer focus hygiene: a tapped or clicked control does not keep a focus ring.
        const control = event.target instanceof Element ? event.target.closest('button') : null;
        if (control instanceof HTMLElement) window.setTimeout(() => { if (document.activeElement === control) control.blur(); }, 0);
      }}
    >
      {/* Shared controls bar */}
      <div className="preview-controls multi-preview-controls">
        {/* Source composition dropdown */}
        <div className="preview-comp-dropdown-wrapper" ref={sourceDropdownRef}>
          <button
            className="preview-comp-dropdown-btn"
            onClick={() => setSourceOpen(!sourceOpen)}
            title="Select source: Custom (per-slot) or a composition (auto-distribute layers)"
          >
            <span className="preview-comp-name">
              {isAutoMode ? sourceComp?.name || 'Unknown' : 'Custom'}
            </span>
            <span className="preview-comp-arrow">▼</span>
          </button>
          {sourceOpen && (
            <div className="preview-comp-dropdown">
              <button
                className={`preview-comp-option ${!isAutoMode ? 'active' : ''}`}
                onClick={() => handleSourceChange(null)}
              >
                Custom
              </button>
              <div className="preview-comp-separator" />
              {visibleCompositions.map((comp) => (
                <button
                  key={comp.id}
                  className={`preview-comp-option ${data.sourceCompositionId === comp.id ? 'active' : ''}`}
                  onClick={() => handleSourceChange(comp.id)}
                >
                  {comp.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Multicam cut mode toggle */}
        <button
          type="button"
          className={`multi-preview-multicam-toggle ${multicamOn ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggleMulticam}
          disabled={!activeCompositionId}
          aria-pressed={multicamOn}
          title={multicamOn
            ? 'Multicam cut mode on: keys 1-4 cut to that camera (playing) or switch the segment (paused)'
            : 'Multicam cut mode: one camera per video track, keys 1-4 switch cameras'}
        >
          Multicam
        </button>

        {/* Transparency toggle */}
        <button
          className={`preview-transparency-toggle ${data.showTransparencyGrid ? 'active' : ''}`}
          onClick={toggleTransparency}
          title="Toggle transparency grid (checkerboard)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <rect x="0" y="0" width="4" height="4" opacity="0.6" />
            <rect x="8" y="0" width="4" height="4" opacity="0.6" />
            <rect x="4" y="4" width="4" height="4" opacity="0.6" />
            <rect x="12" y="4" width="4" height="4" opacity="0.6" />
            <rect x="0" y="8" width="4" height="4" opacity="0.6" />
            <rect x="8" y="8" width="4" height="4" opacity="0.6" />
            <rect x="4" y="12" width="4" height="4" opacity="0.6" />
            <rect x="12" y="12" width="4" height="4" opacity="0.6" />
          </svg>
        </button>

        {/* Quality dropdown */}
        <div className="preview-quality-dropdown-wrapper">
          <button
            className="preview-quality-dropdown-btn"
            onClick={() => setQualityOpen(!qualityOpen)}
            title="Preview quality (affects performance)"
          >
            <span className="preview-quality-label">
              {previewQuality === 1 ? 'Full' : previewQuality === 0.5 ? 'Half' : 'Quarter'}
            </span>
            <span className="preview-comp-arrow">▼</span>
          </button>
          {qualityOpen && (
            <div className="preview-quality-dropdown">
              {([
                { value: 1 as PreviewQuality, label: 'Full', desc: '100%' },
                { value: 0.5 as PreviewQuality, label: 'Half', desc: '50%' },
                { value: 0.25 as PreviewQuality, label: 'Quarter', desc: '25%' },
              ]).map(({ value, label, desc }) => (
                <button
                  key={value}
                  className={`preview-quality-option ${previewQuality === value ? 'active' : ''}`}
                  onClick={() => {
                    setPreviewQuality(value);
                    setQualityOpen(false);
                  }}
                >
                  {label} <span className="preview-quality-desc">{desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2x2 grid — wrapper centers the 16:9 block, grid scales uniformly */}
      <div className="multi-preview-grid-wrapper">
        <div className="multi-preview-grid">
          {data.slots.map((slot, index) => (
            <MultiPreviewSlot
              key={index}
              panelId={panelId}
              slotIndex={index}
              compositionId={slot.compositionId}
              showTransparencyGrid={data.showTransparencyGrid}
              onCompositionChange={(compId) => handleSlotCompositionChange(index, compId)}
              highlighted={highlightedSlot === index}
              multicamAngle={multicamOn && activeCompositionId && activeMulticam?.angles[index]
                ? { compositionId: activeCompositionId, angleIndex: index, label: angleLabels[index] ?? activeMulticam.angles[index].label }
                : null}
              onAir={multicamOn && onAirAngle === index}
              onAngleTap={handleAngleTap}
              autoSource={
                isAutoMode && sourceComp
                  ? { compositionId: sourceComp.id, layerIndex: index }
                  : null
              }
            />
          ))}
        </div>
      </div>

      {status && (
        <p className="multi-preview-status" role="status" data-testid="multi-preview-status">{status}</p>
      )}

      {/* Single stats overlay over the whole panel */}
      <MultiPreviewStatsOverlay
        resolution={outputResolution}
        onOpen={() => activateStatsPanel('stats')}
      />
    </div>
  );
}
