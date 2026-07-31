// SlotGrid - Resolume-style grid with row labels (layers) on left, column numbers on top
// Multi-layer playback: each row (A-D) can have an active composition playing simultaneously
// Default click behavior is editor-first; the live-trigger flag swaps primary click to live launch.
// Drag = reorder/move to any slot. Column header click activates all compositions in that column.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useMIDIStore } from '../../stores/midiStore';
import { playheadState } from '../../services/layerBuilder';
import { layerPlaybackManager } from '../../services/layerPlaybackManager';
import { slotDeckManager } from '../../services/slotDeckManager';
import { getSlotGridLabel } from '../../services/midi/midiMappingSummary';
import { flags } from '../../engine/featureFlags';
import { animateSlotGrid } from './slotGridAnimation';
import { MiniTimeline } from './MiniTimeline';
import { SlotGridDeckBadge } from './components/SlotGridDeckBadge';
import { SlotGridTimeOverlay } from './components/SlotGridTimeOverlay';
import type { Composition } from '../../stores/mediaStore';
import type { SlotDeckState } from '../../stores/mediaStore/types';
import './SlotGrid.css';

interface SlotGridProps {
  opacity: number;
}

const SLOT_SIZE = 100; // fixed slot size in px
const GRID_COLS = 12;
const GRID_ROWS = 4;
const TOTAL_SLOTS = GRID_COLS * GRID_ROWS;
const LABEL_WIDTH = 40;
const EMPTY_SLOT_DECK_STATES: Record<number, SlotDeckState> = {};

export function SlotGrid({ opacity }: SlotGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const slotGridProgress = useTimelineStore(state => state.slotGridProgress);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const slotAssignments = useMediaStore(state => state.slotAssignments);
  const selectedSlotCompositionId = useMediaStore(state => state.selectedSlotCompositionId);
  const activeLayerSlots = useMediaStore(state => state.activeLayerSlots);
  const slotDeckStates = useMediaStore(state => state.slotDeckStates);
  const openCompositionTab = useMediaStore(state => state.openCompositionTab);
  const deactivateLayer = useMediaStore(state => state.deactivateLayer);
  const activateColumn = useMediaStore(state => state.activateColumn);
  const triggerLiveSlot = useMediaStore(state => state.triggerLiveSlot) as (compositionId: string, layerIndex: number) => void;
  const triggerLiveColumn = useMediaStore(state => state.triggerLiveColumn) as (colIndex: number) => void;
  const moveSlot = useMediaStore(state => state.moveSlot);
  const unassignSlot = useMediaStore(state => state.unassignSlot);
  const selectSlotComposition = useMediaStore(
    state => state.selectSlotComposition as ((compositionId: string | null) => void) | undefined
  );
  const ensureSlotClipSettings = useMediaStore(
    state => state.ensureSlotClipSettings as ((compositionId: string, duration: number) => void) | undefined
  );
  const assignMediaFileToSlot = useMediaStore(state => state.assignMediaFileToSlot);
  const getSlotMap = useMediaStore(state => state.getSlotMap);
  const layerOpacities = useMediaStore(state => state.layerOpacities);
  const setLayerOpacity = useMediaStore(state => state.setLayerOpacity) as (layerIndex: number, opacity: number) => void;
  const compositions = useMediaStore(state => state.compositions);
  const files = useMediaStore(state => state.files);

  // Build mediaFileId → thumbnailUrl lookup
  const thumbnailMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of files) {
      if (f.thumbnailUrl) map.set(f.id, f.thumbnailUrl);
    }
    return map;
  }, [files]);

  // Build a set of active composition IDs from activeLayerSlots
  const activeLayerCompIds = useMemo(() => {
    const ids = new Set<string>();
    for (const compId of Object.values(activeLayerSlots)) {
      if (compId) ids.add(compId);
    }
    return ids;
  }, [activeLayerSlots]);
  const resolvedSlotDeckStates = slotDeckStates ?? EMPTY_SLOT_DECK_STATES;
  const prevAssignedSlotsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!flags.useWarmSlotDecks) {
      prevAssignedSlotsRef.current = new Set();
      return;
    }

    const assignedSlots = new Set<number>();
    for (const [compId, slotIndex] of Object.entries(slotAssignments)) {
      assignedSlots.add(slotIndex);
      slotDeckManager.prepareSlot(slotIndex, compId);
    }

    for (const slotIndex of prevAssignedSlotsRef.current) {
      if (!assignedSlots.has(slotIndex)) {
        slotDeckManager.disposeSlot(slotIndex);
      }
    }

    prevAssignedSlotsRef.current = assignedSlots;
  }, [slotAssignments]);

  // Drag state
  const [dragCompId, setDragCompId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isExternalDrag, setIsExternalDrag] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    compId: string;
    compName: string;
    slotIndex: number;
  } | null>(null);

  // Track previous "desired background layers" to diff — only process layers that actually changed
  // A layer is "desired background" when it has a comp assigned AND that comp is NOT the editor comp
  const prevDesiredRef = useRef<Record<number, string>>({});

  // Sync LayerPlaybackManager when activeLayerSlots OR activeCompositionId changes
  // This handles: slot assignment changes, AND editor comp switches (which change which layers
  // are "background" vs "editor-managed" even if activeLayerSlots didn't change)
  useEffect(() => {
    const { compositions } = useMediaStore.getState();
    const slotModeActive = slotGridProgress > 0.5;

    const desired: Record<number, string> = {};
    for (const [key, compId] of Object.entries(activeLayerSlots)) {
      if (compId && (slotModeActive || compId !== activeCompositionId)) {
        desired[Number(key)] = compId;
      }
    }

    const prev = prevDesiredRef.current;

    // Collect all layer indices from both prev and current desired sets
    const allLayerIndices = new Set([
      ...Object.keys(prev).map(Number),
      ...Object.keys(desired).map(Number),
    ]);

    for (const layerIndex of allLayerIndices) {
      const prevCompId = prev[layerIndex] ?? null;
      const newCompId = desired[layerIndex] ?? null;
      if (prevCompId === newCompId) continue; // unchanged — skip

      // Deactivate old background layer
      if (prevCompId) {
        layerPlaybackManager.deactivateLayer(layerIndex);
      }

      // Activate new background layer
      if (newCompId) {
        const comp = compositions.find(c => c.id === newCompId);
        const slotIndex = slotAssignments[newCompId] ?? null;
        const initialElapsed = slotIndex === null ? (comp?.timelineData?.playheadPosition ?? 0) : undefined;
        layerPlaybackManager.activateLayer(layerIndex, newCompId, initialElapsed, { slotIndex });
      }
    }

    prevDesiredRef.current = desired;
  }, [activeLayerSlots, activeCompositionId, slotAssignments, slotGridProgress]);

  // Dismiss context menu on click-outside
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [contextMenu]);

  // Handle Ctrl+Shift+Scroll on the SlotGrid itself
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        if (e.deltaY > 0) {
          // Zoom out → show grid (always allowed)
          animateSlotGrid(1);
        } else {
          // Zoom in → back to timeline, only if hovering a filled slot
          const target = e.target as HTMLElement;
          const slotEl = target.closest('.slot-grid-item:not(.empty)');
          if (!slotEl) return; // Not over a filled slot — block transition
          const compId = slotEl.getAttribute('data-comp-id');
          if (compId) {
            useMediaStore.getState().openCompositionTab(compId, { skipAnimation: true });
          }
          animateSlotGrid(0);
        }
      } else {
        // Stop propagation so timeline's wheel handler doesn't preventDefault
        // This lets the container scroll natively
        e.stopPropagation();
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const openSlotInEditor = useCallback((compId: string) => {
    const mediaState = useMediaStore.getState();
    const comp = mediaState.compositions.find(c => c.id === compId);
    const duration = Math.max(comp?.duration || comp?.timelineData?.duration || 0, 0.05);
    ensureSlotClipSettings?.(compId, duration);

    const playFromTime = useMediaStore.getState().slotClipSettings?.[compId]?.trimIn ?? 0;
    openCompositionTab(compId, {
      skipAnimation: true,
      playFromStart: true,
      playFromTime,
    });
  }, [ensureSlotClipSettings, openCompositionTab]);

  // Click = select slot, open Slot Clip tab, and keep layer activation local to slot view.
  const handleSlotClick = useCallback((comp: Composition, slotIndex: number) => {
    const layerIndex = Math.floor(slotIndex / GRID_COLS);
    const wasLayerActiveForComp = useMediaStore.getState().activeLayerSlots[layerIndex] === comp.id;
    ensureSlotClipSettings?.(comp.id, comp.duration);
    selectSlotComposition?.(comp.id);
    try {
      useDockStore.getState().activatePanelType('clip-properties');
    } catch {
      // Keep slot triggering functional even if dock persistence is unavailable.
    }
    window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab: 'slot-clip' } }));

    if (flags.useLiveSlotTrigger) {
      triggerLiveSlot(comp.id, layerIndex);
      if (wasLayerActiveForComp) {
        layerPlaybackManager.activateLayer(layerIndex, comp.id, undefined, { slotIndex });
      }
      return;
    }

    openSlotInEditor(comp.id);
    useMediaStore.getState().activateOnLayer(comp.id, layerIndex);
    if (wasLayerActiveForComp) {
      layerPlaybackManager.activateLayer(layerIndex, comp.id, undefined, { slotIndex });
    }
  }, [ensureSlotClipSettings, openSlotInEditor, selectSlotComposition, triggerLiveSlot]);

  const handleSlotDoubleClick = useCallback((comp: Composition) => {
    openSlotInEditor(comp.id);
  }, [openSlotInEditor]);

  // Click empty slot = fully deactivate that layer
  const handleEmptySlotClick = useCallback((slotIndex: number) => {
    const layerIndex = Math.floor(slotIndex / GRID_COLS);
    const { activeLayerSlots, activeCompositionId } = useMediaStore.getState();
    const compOnLayer = activeLayerSlots[layerIndex];

    selectSlotComposition?.(null);
    deactivateLayer(layerIndex);

    // Check which layers are still active after removing this one
    const remaining = { ...activeLayerSlots };
    delete remaining[layerIndex];
    const stillActive = Object.entries(remaining)
      .filter(([, id]) => id != null)
      .sort(([a], [b]) => Number(a) - Number(b)); // prefer top layer (A first)

    if (compOnLayer && compOnLayer === activeCompositionId) {
      // Deactivated comp was the editor-active one
      if (stillActive.length > 0) {
        // Don't promote another slot to editor (green→blue) — remaining slots stay green.
        // Save current editor's timeline state, then clear activeCompositionId.
        // Avoids openCompositionTab/setActiveComposition which call pause() globally.
        const ts = useTimelineStore.getState();
        ts.setPlayheadPosition(
          playheadState.isUsingInternalPosition
            ? playheadState.position
            : ts.playheadPosition
        );
        const timelineData = ts.getSerializableState();

        // Stop editor playback and pause all video/audio elements in timeline clips
        // so the deactivated comp doesn't keep playing in the preview
        useTimelineStore.setState({
          isPlaying: false,
          selectedClipIds: new Set(),
          primarySelectedClipId: null,
          propertiesSelection: null,
          selectedKeyframeIds: new Set(),
        });
        for (const clip of ts.clips) {
          if (clip.source?.videoElement && !clip.source.videoElement.paused) {
            clip.source.videoElement.pause();
          }
          if (clip.source?.audioElement && !clip.source.audioElement.paused) {
            clip.source.audioElement.pause();
          }
        }

        const { compositions: freshComps } = useMediaStore.getState();
        useMediaStore.setState({
          activeCompositionId: null,
          compositions: freshComps.map(c =>
            c.id === compOnLayer
              ? { ...c, duration: timelineData.duration, timelineData }
              : c
          ),
        });
      } else {
        // No layers left — stop everything
        useTimelineStore.getState().stop();
        useMediaStore.getState().setActiveComposition(null);
      }
    }
    // If deactivated comp was NOT the editor-active one, other layers keep playing
  }, [deactivateLayer, selectSlotComposition]);

  // Click column header = activate all compositions in that column
  const handleColumnClick = useCallback((colIndex: number) => {
    const slotMap = getSlotMap(TOTAL_SLOTS);
    if (flags.useLiveSlotTrigger) {
      triggerLiveColumn(colIndex);
      return;
    }

    activateColumn(colIndex);
    // Open topmost (row A first) filled slot in that column in editor
    for (let row = 0; row < GRID_ROWS; row++) {
      const comp = slotMap[row * GRID_COLS + colIndex];
      if (comp) {
        openSlotInEditor(comp.id);
        break;
      }
    }
  }, [activateColumn, getSlotMap, openSlotInEditor, triggerLiveColumn]);

  // Right-click context menu on filled slots
  const handleContextMenu = useCallback((e: React.MouseEvent, comp: Composition, slotIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      compId: comp.id,
      compName: comp.name,
      slotIndex,
    });
  }, []);

  const handleRemoveFromSlot = useCallback(() => {
    if (contextMenu) {
      unassignSlot(contextMenu.compId);
      setContextMenu(null);
    }
  }, [contextMenu, unassignSlot]);

  const handleOpenInEditor = useCallback(() => {
    if (contextMenu) {
      openSlotInEditor(contextMenu.compId);
      setContextMenu(null);
    }
  }, [contextMenu, openSlotInEditor]);

  const handleMapMIDISlot = useCallback(() => {
    if (!contextMenu) {
      return;
    }

    const slotLabel = getSlotGridLabel(contextMenu.slotIndex);
    try {
      useDockStore.getState().activatePanelType('midi-mapping');
    } catch {
      // Learning can still be armed even if the dock layout cannot be updated.
    }

    useMIDIStore.getState().startLearning({
      kind: 'slot',
      slotIndex: contextMenu.slotIndex,
      slotLabel,
      compositionId: contextMenu.compId,
      compositionName: contextMenu.compName,
    });
    setContextMenu(null);
  }, [contextMenu]);

  // Drag handlers — track comp ID, not slot index
  const handleDragStart = useCallback((e: React.DragEvent, comp: Composition) => {
    setDragCompId(comp.id);
    setIsExternalDrag(false);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', comp.id);
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    const types = e.dataTransfer.types;
    const isExternal = types.includes('application/x-media-file-id') || types.includes('application/x-composition-id');
    if (isExternal) {
      e.dataTransfer.dropEffect = 'copy';
      setIsExternalDrag(true);
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
    setDragOverIndex(slotIndex);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toSlotIndex: number) => {
    e.preventDefault();
    setDragCompId(null);
    setDragOverIndex(null);
    setIsExternalDrag(false);

    // Check for external drops from MediaPanel
    const mediaFileId = e.dataTransfer.getData('application/x-media-file-id');
    if (mediaFileId) {
      assignMediaFileToSlot(mediaFileId, toSlotIndex);
      return;
    }

    const compositionId = e.dataTransfer.getData('application/x-composition-id');
    if (compositionId) {
      moveSlot(compositionId, toSlotIndex);
      return;
    }

    // Internal slot drag (text/plain = comp ID)
    const compId = e.dataTransfer.getData('text/plain') || dragCompId;
    if (compId) {
      moveSlot(compId, toSlotIndex);
    }
  }, [dragCompId, moveSlot, assignMediaFileToSlot]);

  const handleDragEnd = useCallback(() => {
    setDragCompId(null);
    setDragOverIndex(null);
    setIsExternalDrag(false);
  }, []);

  // Build slot map from assignments (reacts to slotAssignments + compositions changes)
  const slotMap = useMemo(() => {
    return getSlotMap(TOTAL_SLOTS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSlotMap, slotAssignments, compositions]);

  return (
    <div
      ref={containerRef}
      className="slot-grid-container"
      style={{ opacity }}
    >
      <div
        className="slot-grid-resolume"
        style={{
          gridTemplateColumns: `${LABEL_WIDTH}px repeat(${GRID_COLS}, ${SLOT_SIZE}px)`,
          gridTemplateRows: `24px repeat(${GRID_ROWS}, ${SLOT_SIZE}px)`,
        }}
      >
        {/* Empty corner */}
        <div className="slot-grid-corner" />

        {/* Column headers — clickable to activate column */}
        {Array.from({ length: GRID_COLS }, (_, i) => (
          <div
            key={`col-${i}`}
            className="slot-grid-col-header slot-grid-col-header-clickable"
            onClick={() => handleColumnClick(i)}
            title={`Activate column ${i + 1}`}
          >
            {i + 1}
          </div>
        ))}

        {/* Rows: label + slots */}
        {Array.from({ length: GRID_ROWS }, (_, rowIndex) => (
          <Fragment key={`row-${rowIndex}`}>
            <div className="slot-grid-row-label">
              <span className="slot-grid-row-letter">{String.fromCharCode(65 + rowIndex)}</span>
              <input
                type="range"
                className="slot-grid-opacity-slider"
                min={0}
                max={1}
                step={0.01}
                value={layerOpacities[rowIndex] ?? 1}
                onChange={(e) => setLayerOpacity(rowIndex, parseFloat(e.target.value))}
                title={`Layer ${String.fromCharCode(65 + rowIndex)} opacity: ${Math.round((layerOpacities[rowIndex] ?? 1) * 100)}%`}
              />
            </div>
            {Array.from({ length: GRID_COLS }, (_, colIndex) => {
              const slotIndex = rowIndex * GRID_COLS + colIndex;
              const comp = slotMap[slotIndex];
              const isDragOver = slotIndex === dragOverIndex && (dragCompId !== null || isExternalDrag);
              const deckState = flags.useWarmSlotDecks ? resolvedSlotDeckStates[slotIndex] : undefined;
              const slotDeckTitle = deckState
                ? `${deckState.status}${deckState.decoderMode !== 'unknown' ? ` / ${deckState.decoderMode}` : ''}`
                : null;

              if (comp) {
                const isEditorActive = comp.id === activeCompositionId;
                const isLayerActive = activeLayerCompIds.has(comp.id);
                const isSelected = comp.id === selectedSlotCompositionId;
                const isSelf = comp.id === dragCompId;
                // Find thumbnail from first video clip's media file
                const firstVideoClip = comp.timelineData?.clips?.find(
                  (c: { sourceType: string; mediaFileId?: string }) => c.sourceType === 'video' && c.mediaFileId
                );
                const thumbUrl = firstVideoClip?.mediaFileId ? thumbnailMap.get(firstVideoClip.mediaFileId) : undefined;
                return (
                  <div
                    key={slotIndex}
                    className={
                      `slot-grid-item` +
                      `${isEditorActive ? ' active' : ''}` +
                      `${isLayerActive && !isEditorActive ? ' layer-active' : ''}` +
                      `${isSelected ? ' selected' : ''}` +
                      `${isDragOver && !isSelf ? ' drag-over' : ''}`
                    }
                    data-comp-id={comp.id}
                    style={{
                      position: 'relative',
                      ...(thumbUrl
                        ? { backgroundImage: `url(${thumbUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : {}),
                    }}
                    onClick={() => handleSlotClick(comp, slotIndex)}
                    onDoubleClick={() => handleSlotDoubleClick(comp)}
                    onContextMenu={(e) => handleContextMenu(e, comp, slotIndex)}
                    title={
                      `${flags.useLiveSlotTrigger
                        ? `${comp.name} - Click to trigger live, double-click to open in editor`
                        : comp.name}` +
                      (slotDeckTitle ? ` | Deck: ${slotDeckTitle}` : '')
                    }
                    draggable
                    onDragStart={(e) => handleDragStart(e, comp)}
                    onDragEnter={handleDragEnter}
                    onDragOver={(e) => handleDragOver(e, slotIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, slotIndex)}
                    onDragEnd={handleDragEnd}
                  >
                    <MiniTimeline
                      timelineData={comp.timelineData}
                      compositionName={comp.name}
                      compositionDuration={comp.duration}
                      isActive={isEditorActive}
                      width={SLOT_SIZE - 4}
                      height={SLOT_SIZE - 4}
                    />
                    <div className="slot-grid-name">{comp.name}</div>
                    <SlotGridTimeOverlay
                      compId={comp.id}
                      duration={comp.duration}
                      isActive={isEditorActive || isLayerActive}
                      layerIndex={rowIndex}
                      slotSize={SLOT_SIZE - 4}
                      initialPosition={comp.timelineData?.playheadPosition ?? 0}
                    />
                    {deckState && (
                      <SlotGridDeckBadge
                        slotIndex={slotIndex}
                        deckState={deckState}
                        slotDeckTitle={slotDeckTitle}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={slotIndex}
                  className={`slot-grid-item empty${isDragOver ? ' drag-over' : ''}`}
                  style={{ position: 'relative' }}
                  onClick={() => handleEmptySlotClick(slotIndex)}
                  onDragEnter={handleDragEnter}
                  onDragOver={(e) => handleDragOver(e, slotIndex)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, slotIndex)}
                  title={slotDeckTitle ? `Deck: ${slotDeckTitle}` : undefined}
                >
                  {deckState && (
                    <SlotGridDeckBadge
                      slotIndex={slotIndex}
                      deckState={deckState}
                      slotDeckTitle={slotDeckTitle}
                    />
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="slot-grid-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={handleOpenInEditor}>Open in Editor</button>
          <button onClick={handleMapMIDISlot}>
            Map MIDI to Slot {getSlotGridLabel(contextMenu.slotIndex)}
          </button>
          <button onClick={handleRemoveFromSlot}>Remove from Slot</button>
        </div>
      )}
    </div>
  );
}
