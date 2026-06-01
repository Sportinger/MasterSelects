// Tab group container with tab bar and panel content

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { DockTabGroup, DockPanel, PanelType } from '../../types/dock';
import { DEPRECATED_PANEL_TYPES, MULTI_INSTANCE_PANEL_TYPES, PANEL_CONFIGS, WIP_PANEL_TYPES } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { DockPanelContent } from './DockPanelContent';
import { calculateDropPosition } from '../../utils/dockLayout';

// Truncate text with ellipsis
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 2) + '..';
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

const HOLD_DURATION = 500; // ms to hold before drag starts
const TAB_INSERT_HOT_ZONE_PX = 36;
const TAB_SLOT_SIZE_PX = 22;
const TAB_SLOT_GAP_PX = 7;
const CHANGE_TO_PANEL_TYPES = (Object.keys(PANEL_CONFIGS) as PanelType[])
  .filter((type) => !DEPRECATED_PANEL_TYPES.includes(type));

// Add-panel "+" menu order: multi-instance (spawnable) types like Preview float to the top.
const ADD_MENU_PANEL_TYPES = [...CHANGE_TO_PANEL_TYPES].sort((a, b) => (
  (MULTI_INSTANCE_PANEL_TYPES.includes(a) ? 0 : 1) - (MULTI_INSTANCE_PANEL_TYPES.includes(b) ? 0 : 1)
));

interface DockTabContextMenuState {
  x: number;
  y: number;
  panel: DockPanel;
}

interface DockTabPaneProps {
  group: DockTabGroup;
}

export function DockTabPane({ group }: DockTabPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef<{
    panel: DockPanel;
    offset: { x: number; y: number };
    mousePos: { x: number; y: number };
  } | null>(null);
  const [holdingTabId, setHoldingTabId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState<'idle' | 'holding' | 'ready' | 'fading'>('idle');
  const [tabContextMenu, setTabContextMenu] = useState<DockTabContextMenuState | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);

  const {
    setActiveTab,
    startDrag,
    updateDrag,
    dragState,
    setPanelZoom,
    layout,
    activatePanelType,
    closePanelById,
    changePanelType,
    addPanelTypeToGroup,
    floatPanel,
    getVisiblePanelTypes,
    hoveredTabTarget,
    setHoveredTabTarget,
    clearHoveredTabTarget,
    maximizedPanelId,
    setMaximizedPanel,
  } = useDockStore(useShallow(s => ({
    setActiveTab: s.setActiveTab,
    startDrag: s.startDrag,
    updateDrag: s.updateDrag,
    dragState: s.dragState,
    setPanelZoom: s.setPanelZoom,
    layout: s.layout,
    activatePanelType: s.activatePanelType,
    closePanelById: s.closePanelById,
    changePanelType: s.changePanelType,
    addPanelTypeToGroup: s.addPanelTypeToGroup,
    floatPanel: s.floatPanel,
    getVisiblePanelTypes: s.getVisiblePanelTypes,
    hoveredTabTarget: s.hoveredTabTarget,
    setHoveredTabTarget: s.setHoveredTabTarget,
    clearHoveredTabTarget: s.clearHoveredTabTarget,
    maximizedPanelId: s.maximizedPanelId,
    setMaximizedPanel: s.setMaximizedPanel,
  })));
  const {
    getOpenCompositions,
    activeCompositionId,
    compositions,
    selectedSlotCompositionId,
    setActiveComposition,
    closeCompositionTab,
    reorderCompositionTabs
  } = useMediaStore(useShallow(s => ({
    getOpenCompositions: s.getOpenCompositions,
    activeCompositionId: s.activeCompositionId,
    compositions: s.compositions,
    selectedSlotCompositionId: s.selectedSlotCompositionId,
    setActiveComposition: s.setActiveComposition,
    closeCompositionTab: s.closeCompositionTab,
    reorderCompositionTabs: s.reorderCompositionTabs,
  })));
  const { clips, selectedClipIds, slotGridProgress, tracks, masterAudioState, propertiesSelection } = useTimelineStore(useShallow(s => ({
    clips: s.clips,
    selectedClipIds: s.selectedClipIds,
    slotGridProgress: s.slotGridProgress,
    tracks: s.tracks,
    masterAudioState: s.masterAudioState,
    propertiesSelection: s.propertiesSelection,
  })));

  // Get selected clip name for dynamic tab titles (Properties/Audio panels)
  const selectedClipName = useMemo(() => {
    if (propertiesSelection?.kind === 'clip') {
      return clips.find(c => c.id === propertiesSelection.clipId)?.name || null;
    }
    if (selectedClipIds.size === 0) return null;
    const clipId = [...selectedClipIds][0];
    const clip = clips.find(c => c.id === clipId);
    return clip?.name || null;
  }, [clips, propertiesSelection, selectedClipIds]);
  const selectedPropertiesName = useMemo(() => {
    if (propertiesSelection?.kind === 'track') {
      const track = tracks.find(item => item.id === propertiesSelection.trackId);
      return track ? `TRACK ${track.name}` : null;
    }
    if (propertiesSelection?.kind === 'master') {
      return 'MASTER Master';
    }
    return selectedClipName ? `CLIP ${selectedClipName}` : null;
  }, [propertiesSelection, selectedClipName, tracks]);
  const selectedSlotName = useMemo(() => {
    if (slotGridProgress <= 0.5 || !selectedSlotCompositionId) {
      return null;
    }

    return compositions.find((comp) => comp.id === selectedSlotCompositionId)?.name || null;
  }, [compositions, selectedSlotCompositionId, slotGridProgress]);
  const audioMixerTabStats = useMemo(() => {
    const audioTracks = tracks.filter((track) => track.type === 'audio');
    const activeSends = audioTracks.reduce((count, track) => (
      count + (track.audioState?.sends?.filter((send) => send.enabled !== false).length ?? 0)
    ), 0);
    const activeFx = audioTracks.reduce((count, track) => (
      count + (track.audioState?.effectStack?.filter((effect) => effect.enabled !== false).length ?? 0)
    ), masterAudioState?.effectStack?.filter((effect) => effect.enabled !== false).length ?? 0);

    return {
      label: `Audio Mixer ${audioTracks.length}T / ${activeSends}S / ${activeFx}FX`,
      title: `Audio Mixer - ${pluralize(audioTracks.length, 'track')} / ${pluralize(activeSends, 'send')} / ${pluralize(activeFx, 'FX', 'FX')}`,
    };
  }, [masterAudioState, tracks]);

  // State for dragging composition tabs
  const [draggedCompIndex, setDraggedCompIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Middle mouse drag scrolling for tabs
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);
  const middleDragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);

  const activePanel = group.panels[group.activeIndex];
  const isDropTarget = dragState.dropTarget?.scope !== 'root-edge' && dragState.dropTarget?.groupId === group.id;
  const dropPosition = isDropTarget ? dragState.dropTarget?.position : undefined;
  const showTabSlotOverlay = isDropTarget && dropPosition === 'center' && dragState.dropTarget?.tabInsertIndex !== undefined;
  const showCenterDropOverlay = isDropTarget && dropPosition === 'center';
  const panelZoom = activePanel ? (layout.panelZoom?.[activePanel.id] ?? 1.0) : 1.0;
  const timelinePanel = useMemo(() => group.panels.find((panel) => panel.type === 'timeline') ?? null, [group.panels]);
  const hoveredPanelId = hoveredTabTarget?.panelId ?? null;
  const groupContainsMaximizedPanel = maximizedPanelId !== null && group.panels.some((panel) => panel.id === maximizedPanelId);
  const isActivePanelMaximized = activePanel?.id === maximizedPanelId;
  const layoutAnimationId = activePanel ? `panel:${activePanel.id}` : `group:${group.id}`;

  // Check if this group contains a timeline panel
  const hasTimelinePanel = timelinePanel !== null;
  const openCompositions = hasTimelinePanel ? getOpenCompositions() : [];

  // Composition tab drag handlers (for reordering)
  const handleCompDragStart = useCallback((e: React.DragEvent, index: number) => {
    // Only start reorder drag if not holding for dock drag
    if (holdProgress !== 'idle') {
      e.preventDefault();
      return;
    }
    setDraggedCompIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, [holdProgress]);

  const handleCompDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedCompIndex !== null && draggedCompIndex !== index) {
      setDropTargetIndex(index);
    }
  }, [draggedCompIndex]);

  const handleCompDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleCompDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (draggedCompIndex !== null && draggedCompIndex !== toIndex) {
      reorderCompositionTabs(draggedCompIndex, toIndex);
    }
    setDraggedCompIndex(null);
    setDropTargetIndex(null);
  }, [draggedCompIndex, reorderCompositionTabs]);

  const handleCompDragEnd = useCallback(() => {
    setDraggedCompIndex(null);
    setDropTargetIndex(null);
  }, []);

  // Hold-to-drag handler for composition tabs (to move the timeline panel)
  // Note: Currently unused but kept for potential future implementation
  const _handleCompTabMouseDown = useCallback((e: React.MouseEvent, compId: string) => {
    if (e.button !== 0) return;

    // Find the timeline panel in this group
    const timelinePanel = group.panels.find(p => p.type === 'timeline');
    if (!timelinePanel) return;

    // Set composition as active
    setActiveComposition(compId);

    // Store offset and mouse position for when dock drag actually starts
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const offset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const mousePos = { x: e.clientX, y: e.clientY };

    // Start hold animation
    setHoldingTabId(compId);
    setHoldProgress('holding');
    holdStartRef.current = { panel: timelinePanel, offset, mousePos };

    // After hold duration, start the actual dock panel drag
    holdTimerRef.current = window.setTimeout(() => {
      if (holdStartRef.current) {
        setHoldProgress('ready');
        const { panel: p, offset: o, mousePos: pos } = holdStartRef.current;
        startDrag(p, group.id, o, pos);
        setTimeout(() => {
          setHoldProgress('idle');
          setHoldingTabId(null);
        }, 100);
      }
    }, HOLD_DURATION);
  }, [group.panels, group.id, setActiveComposition, startDrag]);
  void _handleCompTabMouseDown; // Silence unused warning

  // Cancel any ongoing hold
  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = null;

    // If we were holding, trigger fade out animation
    if (holdProgress === 'holding') {
      setHoldProgress('fading');
      // After fade animation, reset to idle
      setTimeout(() => {
        setHoldProgress('idle');
        setHoldingTabId(null);
      }, HOLD_DURATION);
    } else {
      setHoldProgress('idle');
      setHoldingTabId(null);
    }
  }, [holdProgress]);

  const _handleCompTabMouseUp = useCallback(() => {
    if (holdProgress === 'holding') {
      cancelHold();
    }
  }, [holdProgress, cancelHold]);
  void _handleCompTabMouseUp; // Silence unused warning

  const _handleCompTabMouseLeave = useCallback(() => {
    if (holdProgress === 'holding') {
      cancelHold();
    }
  }, [holdProgress, cancelHold]);
  void _handleCompTabMouseLeave; // Silence unused warning

  const openTabContextMenu = useCallback((event: React.MouseEvent, panel: DockPanel) => {
    event.preventDefault();
    event.stopPropagation();
    cancelHold();
    const maxMenuX = Math.max(8, window.innerWidth - 430);
    const maxMenuY = Math.max(8, window.innerHeight - 120);
    setTabContextMenu({
      x: Math.max(8, Math.min(event.clientX, maxMenuX)),
      y: Math.max(8, Math.min(event.clientY, maxMenuY)),
      panel,
    });
  }, [cancelHold]);

  const handleTabClick = useCallback((index: number) => {
    setActiveTab(group.id, index);
    if (groupContainsMaximizedPanel) {
      setMaximizedPanel(group.panels[index]?.id ?? null);
    }
  }, [group.id, group.panels, groupContainsMaximizedPanel, setActiveTab, setMaximizedPanel]);

  const handleTabMouseDown = useCallback((e: React.MouseEvent, panel: DockPanel, index: number) => {
    if (e.button !== 0) return;

    // Set this tab as active
    setActiveTab(group.id, index);

    // Store offset and mouse position for when drag actually starts
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const offset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    const mousePos = { x: e.clientX, y: e.clientY };

    // Start hold animation
    setHoldingTabId(panel.id);
    setHoldProgress('holding');
    holdStartRef.current = { panel, offset, mousePos };

    // After hold duration, start the actual drag
    holdTimerRef.current = window.setTimeout(() => {
      if (holdStartRef.current) {
        setHoldProgress('ready');
        const { panel: p, offset: o, mousePos: pos } = holdStartRef.current;
        // Start drag with correct initial position
        startDrag(p, group.id, o, pos);
        // Reset hold state after drag starts
        setTimeout(() => {
          setHoldProgress('idle');
          setHoldingTabId(null);
        }, 100);
      }
    }, HOLD_DURATION);
  }, [group.id, setActiveTab, startDrag]);

  const handleTabContextMenu = useCallback((event: React.MouseEvent, panel: DockPanel, index: number) => {
    setActiveTab(group.id, index);
    if (groupContainsMaximizedPanel) {
      setMaximizedPanel(panel.id);
    }
    openTabContextMenu(event, panel);
  }, [group.id, groupContainsMaximizedPanel, openTabContextMenu, setActiveTab, setMaximizedPanel]);

  const handleTabMouseUp = useCallback(() => {
    // Only cancel if we're still in holding phase (not yet dragging)
    if (holdProgress === 'holding') {
      cancelHold();
    }
  }, [holdProgress, cancelHold]);

  const handleTabMouseLeave = useCallback(() => {
    // Cancel hold if mouse leaves the tab before 500ms is reached
    if (holdProgress === 'holding') {
      cancelHold();
    }
  }, [holdProgress, cancelHold]);

  const handlePanelTabMouseEnter = useCallback((panel: DockPanel) => {
    setHoveredTabTarget({
      kind: 'panel',
      panelId: panel.id,
      groupId: group.id,
    });
  }, [group.id, setHoveredTabTarget]);

  const handlePanelTabMouseLeave = useCallback((panelId: string) => {
    handleTabMouseLeave();
    clearHoveredTabTarget(panelId);
  }, [clearHoveredTabTarget, handleTabMouseLeave]);

  const handleCompositionTabMouseEnter = useCallback((compositionId: string) => {
    if (!timelinePanel) return;
    setHoveredTabTarget({
      kind: 'timeline-composition',
      panelId: timelinePanel.id,
      groupId: group.id,
      compositionId,
    });
  }, [group.id, setHoveredTabTarget, timelinePanel]);

  const handleCompositionTabMouseLeave = useCallback(() => {
    if (!timelinePanel) return;
    clearHoveredTabTarget(timelinePanel.id);
  }, [clearHoveredTabTarget, timelinePanel]);

  const handlePaneMouseEnter = useCallback(() => {
    if (hasTimelinePanel && timelinePanel) {
      setHoveredTabTarget({
        kind: activeCompositionId ? 'timeline-composition' : 'panel',
        panelId: timelinePanel.id,
        groupId: group.id,
        compositionId: activeCompositionId ?? undefined,
      });
      return;
    }

    if (activePanel) {
      setHoveredTabTarget({
        kind: 'panel',
        panelId: activePanel.id,
        groupId: group.id,
      });
    }
  }, [activeCompositionId, activePanel, group.id, hasTimelinePanel, setHoveredTabTarget, timelinePanel]);

  const handleTabBarContextMenu = useCallback((event: React.MouseEvent) => {
    if (!hasTimelinePanel || !timelinePanel) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('.dock-tab')) {
      return;
    }

    const timelinePanelIndex = group.panels.findIndex((panel) => panel.id === timelinePanel.id);
    if (timelinePanelIndex >= 0) {
      setActiveTab(group.id, timelinePanelIndex);
    }
    if (groupContainsMaximizedPanel) {
      setMaximizedPanel(timelinePanel.id);
    }
    openTabContextMenu(event, timelinePanel);
  }, [
    group.id,
    group.panels,
    groupContainsMaximizedPanel,
    hasTimelinePanel,
    openTabContextMenu,
    setActiveTab,
    setMaximizedPanel,
    timelinePanel,
  ]);

  const handleHideContextPanel = useCallback(() => {
    if (!tabContextMenu) return;
    closePanelById(tabContextMenu.panel.id);
    setTabContextMenu(null);
  }, [closePanelById, tabContextMenu]);

  const handleFloatContextPanel = useCallback(() => {
    if (!tabContextMenu) return;
    // Open the floating window slightly offset from where the menu was invoked
    // so it doesn't sit exactly under the pointer.
    floatPanel(tabContextMenu.panel.id, group.id, {
      x: Math.max(8, tabContextMenu.x - 40),
      y: Math.max(8, tabContextMenu.y - 8),
    });
    setTabContextMenu(null);
  }, [floatPanel, group.id, tabContextMenu]);

  const handleChangeContextPanelType = useCallback((type: PanelType) => {
    if (!tabContextMenu) return;
    changePanelType(tabContextMenu.panel.id, type);
    setTabContextMenu(null);
  }, [changePanelType, tabContextMenu]);

  // "+" button on the tab bar: open a menu of panels that can be added (#190)
  const handleAddButtonClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 2 }));
  }, []);

  const handleAddPanelType = useCallback((type: PanelType) => {
    addPanelTypeToGroup(type, group.id);
    setAddMenu(null);
  }, [addPanelTypeToGroup, group.id]);

  useEffect(() => {
    if (!addMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setAddMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenu(null);
    };
    // Close on outside scroll, but allow scrolling inside the menu itself (#198).
    const handleScroll = (event: Event) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setAddMenu(null);
    };
    const handleResize = () => setAddMenu(null);

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [addMenu]);

  useEffect(() => {
    if (!tabContextMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setTabContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTabContextMenu(null);
      }
    };
    // Close on outside scroll, but allow scrolling inside the "Change to" submenu (#198).
    const handleScroll = (event: Event) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setTabContextMenu(null);
    };
    const handleResize = () => setTabContextMenu(null);

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [tabContextMenu]);

  // Clean up timer on unmount and handle global mouse events during hold
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (holdProgress === 'holding') {
        cancelHold();
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // Update stored mouse position during hold so drag starts at correct pos
      if (holdProgress === 'holding' && holdStartRef.current) {
        holdStartRef.current.mousePos = { x: e.clientX, y: e.clientY };
      }
    };

    // Add global listeners
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('mousemove', handleGlobalMouseMove);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      // Don't clear timer here - it's managed by cancelHold and mouseDown
    };
  }, [holdProgress, cancelHold]);

  // Cleanup timer on unmount only
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  // Calculate tab insert index against the visible slot cubes centered in the drop square.
  const calculateTabInsertIndex = useCallback((mouseX: number, paneRect: DOMRect): number => {
    const slotCount = group.panels.length + 1;
    if (slotCount <= 1 || paneRect.width <= 0) return 0;

    const rowWidth = slotCount * TAB_SLOT_SIZE_PX + (slotCount - 1) * TAB_SLOT_GAP_PX;
    const slotStep = TAB_SLOT_SIZE_PX + TAB_SLOT_GAP_PX;
    const firstSlotCenterX = paneRect.left + paneRect.width / 2 - rowWidth / 2 + TAB_SLOT_SIZE_PX / 2;
    const rawIndex = Math.round((mouseX - firstSlotCenterX) / slotStep);

    return Math.max(0, Math.min(slotCount - 1, rawIndex));
  }, [group.panels.length]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.isDragging) {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.dock-tab')) {
        handlePaneMouseEnter();
      }
      return;
    }
    if (!containerRef.current) return;
    if (dragState.sourceGroupId === group.id && group.panels.length === 1) return;

    const rect = containerRef.current.getBoundingClientRect();
    const tabBarRect = tabBarRef.current?.getBoundingClientRect();
    let position = calculateDropPosition(rect, e.clientX, e.clientY);

    let tabInsertIndex: number | undefined;
    if (tabBarRect && e.clientY >= tabBarRect.top && e.clientY <= tabBarRect.bottom + TAB_INSERT_HOT_ZONE_PX) {
      // Mouse is over tab bar - use center with specific insert index
      position = 'center';
      tabInsertIndex = calculateTabInsertIndex(e.clientX, rect);
    } else if (position === 'center') {
      // Center tab-group drops still need an explicit insertion slot.
      tabInsertIndex = calculateTabInsertIndex(e.clientX, rect);
    }

    updateDrag(
      { x: e.clientX, y: e.clientY },
      { groupId: group.id, position, tabInsertIndex }
    );
  }, [dragState.isDragging, dragState.sourceGroupId, group.id, group.panels.length, updateDrag, calculateTabInsertIndex, handlePaneMouseEnter]);

  const handleMouseLeave = useCallback(() => {
    clearHoveredTabTarget();
    if (dragState.isDragging && dragState.dropTarget?.scope !== 'root-edge' && dragState.dropTarget?.groupId === group.id) {
      updateDrag(dragState.currentPos, null);
    }
  }, [clearHoveredTabTarget, dragState, group.id, updateDrag]);

  // Handle Ctrl+wheel for panel zoom (only on tab bar)
  useEffect(() => {
    const tabBar = tabBarRef.current;
    if (!tabBar) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !activePanel) return;

      // Prevent browser zoom
      e.preventDefault();
      e.stopPropagation();

      // Calculate new zoom
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const currentZoom = layout.panelZoom?.[activePanel.id] ?? 1.0;
      setPanelZoom(activePanel.id, currentZoom + delta);
    };

    tabBar.addEventListener('wheel', handleWheel, { passive: false });
    return () => tabBar.removeEventListener('wheel', handleWheel);
  }, [activePanel, layout.panelZoom, setPanelZoom]);

  // Middle mouse drag to scroll tabs horizontally (like Blender)
  const handleTabBarMouseDown = useCallback((e: React.MouseEvent) => {
    // Only handle middle mouse button
    if (e.button !== 1) return;
    e.preventDefault();

    const tabBar = tabBarRef.current;
    if (!tabBar) return;

    setIsMiddleDragging(true);
    middleDragStartRef.current = {
      x: e.clientX,
      scrollLeft: tabBar.scrollLeft,
    };
  }, []);

  // Global mouse move/up for middle drag scrolling
  useEffect(() => {
    if (!isMiddleDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const tabBar = tabBarRef.current;
      if (!tabBar || !middleDragStartRef.current) return;

      const deltaX = e.clientX - middleDragStartRef.current.x;
      tabBar.scrollLeft = middleDragStartRef.current.scrollLeft - deltaX;
    };

    const handleMouseUp = () => {
      setIsMiddleDragging(false);
      middleDragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMiddleDragging]);

  return (
    <div
      ref={containerRef}
      className={`dock-tab-pane ${isDropTarget ? 'drop-target' : ''} ${groupContainsMaximizedPanel ? 'is-maximized-pane' : ''}`}
      data-group-id={group.id}
      data-dock-layout-anim-id={layoutAnimationId}
      data-dock-layout-anim-title={activePanel?.title ?? group.id}
      onMouseEnter={handlePaneMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Tab bar - Ctrl+wheel here to zoom panel, middle mouse to scroll */}
      <div
        ref={tabBarRef}
        className={`dock-tab-bar ${isMiddleDragging ? 'middle-dragging' : ''} ${groupContainsMaximizedPanel ? 'is-maximized-bar' : ''}`}
        title="Ctrl+Scroll to zoom | Hold to drag | Middle-click drag to scroll"
        onMouseDown={handleTabBarMouseDown}
        onContextMenu={handleTabBarContextMenu}
        style={hasTimelinePanel && openCompositions.length > 0 && slotGridProgress > 0 ? {
          height: `${Math.round((1 - slotGridProgress) * 26)}px`,
          minHeight: 0,
          opacity: 1 - slotGridProgress,
          overflow: 'hidden',
        } : undefined}
      >
        {/* For timeline panels, show drag handle + composition tabs (animated out in slot view) */}
        {hasTimelinePanel && openCompositions.length > 0 && slotGridProgress < 1 ? (
          <>
            {/* Drag handle for repositioning the timeline panel */}
            {(() => {
              const isHandleHolding = holdingTabId === 'timeline-handle' && holdProgress === 'holding';
              const isHandleReady = holdingTabId === 'timeline-handle' && holdProgress === 'ready';
              const isHandleFading = holdingTabId === 'timeline-handle' && holdProgress === 'fading';
              return timelinePanel ? (
                <div
                  className={`dock-tab-handle ${isHandleHolding ? 'hold-glow' : ''} ${isHandleReady ? 'hold-ready' : ''} ${isHandleFading ? 'hold-fade' : ''}`}
                  title="Hold to reposition panel"
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    const offset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    const mousePos = { x: e.clientX, y: e.clientY };
                    setHoldingTabId('timeline-handle');
                    setHoldProgress('holding');
                    holdStartRef.current = { panel: timelinePanel, offset, mousePos };
                    holdTimerRef.current = window.setTimeout(() => {
                      if (holdStartRef.current) {
                        setHoldProgress('ready');
                        const { panel: p, offset: o, mousePos: pos } = holdStartRef.current;
                        startDrag(p, group.id, o, pos);
                        setTimeout(() => {
                          setHoldProgress('idle');
                          setHoldingTabId(null);
                        }, 100);
                      }
                    }, HOLD_DURATION);
                  }}
                  onMouseUp={() => { if (holdProgress === 'holding') cancelHold(); }}
                  onMouseLeave={() => { if (holdProgress === 'holding') cancelHold(); }}
                >
                  ⋮⋮
                </div>
              ) : null;
            })()}
            {/* Composition tabs - drag to reorder only */}
            {openCompositions.map((comp, index) => (
              <div
                key={comp.id}
                className={`dock-tab ${comp.id === activeCompositionId ? 'active' : ''} ${
                  draggedCompIndex === index ? 'dragging' : ''
                } ${dropTargetIndex === index ? 'drop-target-tab' : ''} ${
                  hoveredTabTarget?.kind === 'timeline-composition' && hoveredTabTarget.compositionId === comp.id ? 'shortcut-hover' : ''
                } ${maximizedPanelId === timelinePanel?.id && comp.id === activeCompositionId ? 'maximized-target' : ''}`}
                onClick={() => {
                  setActiveComposition(comp.id);
                  activatePanelType('media');
                }}
                title={comp.name}
                onMouseEnter={() => handleCompositionTabMouseEnter(comp.id)}
                onMouseLeave={handleCompositionTabMouseLeave}
                draggable
                onDragStart={(e) => handleCompDragStart(e, index)}
                onDragOver={(e) => handleCompDragOver(e, index)}
                onDragLeave={handleCompDragLeave}
                onDrop={(e) => handleCompDrop(e, index)}
                onDragEnd={handleCompDragEnd}
              >
                <span className="dock-tab-title">{comp.name}</span>
                <button
                  className="dock-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeCompositionTab(comp.id);
                  }}
                  title="Close"
                >
                  ×
                </button>
              </div>
            ))}
          </>
        ) : (
          /* Normal dock tabs for non-timeline panels */
          group.panels.map((panel, index) => {
            const isHolding = holdingTabId === panel.id && holdProgress === 'holding';
            const isReady = holdingTabId === panel.id && holdProgress === 'ready';
            const isFading = holdingTabId === panel.id && holdProgress === 'fading';
            const isDragging = dragState.isDragging && dragState.draggedPanel?.id === panel.id;

            // Dynamic tab title for clip-properties panel
            let tabTitle = panel.title;
            let tabTooltip = panel.title;
            if (panel.type === 'clip-properties' && (selectedSlotName || selectedPropertiesName)) {
              tabTitle = truncateText(selectedSlotName || selectedPropertiesName || panel.title, 18);
              tabTooltip = selectedSlotName || selectedPropertiesName || panel.title;
            } else if (panel.type === 'audio-mixer') {
              tabTitle = audioMixerTabStats.label;
              tabTooltip = audioMixerTabStats.title;
            }

            return (
              <div
                key={panel.id}
                className={`dock-tab ${index === group.activeIndex ? 'active' : ''} ${
                  isDragging ? 'dragging' : ''
                } ${isHolding ? 'hold-glow' : ''} ${isReady ? 'hold-ready' : ''} ${isFading ? 'hold-fade' : ''} ${
                  hoveredPanelId === panel.id ? 'shortcut-hover' : ''
                } ${maximizedPanelId === panel.id ? 'maximized-target' : ''}`}
                onClick={() => handleTabClick(index)}
                onMouseDown={(e) => handleTabMouseDown(e, panel, index)}
                onContextMenu={(e) => handleTabContextMenu(e, panel, index)}
                onMouseUp={handleTabMouseUp}
                onMouseEnter={() => handlePanelTabMouseEnter(panel)}
                onMouseLeave={() => handlePanelTabMouseLeave(panel.id)}
                title={tabTooltip}
                data-guided-panel-tab={panel.type}
                data-guided-target={`panel-tab:${panel.type}`}
                data-dock-layout-anim-id={`panel:${panel.id}`}
                data-dock-layout-anim-title={panel.title}
              >
                <span className="dock-tab-title">{tabTitle}{WIP_PANEL_TYPES.includes(panel.type) && <span className="menu-wip-badge">🐛</span>}</span>
              </div>
            );
          })
        )}
        <button
          className={`dock-tab-add ${addMenu ? 'is-open' : ''}`}
          type="button"
          title="Add panel"
          aria-label="Add panel"
          onClick={handleAddButtonClick}
          onMouseDown={(e) => e.stopPropagation()}
        >
          +
        </button>
      </div>

      {addMenu && (
        <div
          ref={addMenuRef}
          className="dock-tab-add-menu"
          style={{ left: addMenu.x, top: addMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const visibleTypes = new Set(getVisiblePanelTypes());
            return ADD_MENU_PANEL_TYPES.map((type) => {
              const config = PANEL_CONFIGS[type];
              const isMulti = MULTI_INSTANCE_PANEL_TYPES.includes(type);
              const isVisible = visibleTypes.has(type);
              const isWip = WIP_PANEL_TYPES.includes(type);
              // Multi-instance types spawn a new instance every time, so they are
              // never "current" — clicking always adds another side-by-side.
              const title = isMulti
                ? `Add another ${config.title}`
                : (isVisible ? `${config.title} (focus existing)` : `Add ${config.title}`);
              return (
                <button
                  key={type}
                  className={`dock-tab-add-menu-item ${(!isMulti && isVisible) ? 'is-current' : ''}`}
                  type="button"
                  onClick={() => handleAddPanelType(type)}
                  title={title}
                >
                  <span>{config.title}</span>
                  {isWip && <span className="dock-tab-context-menu-hint">WIP</span>}
                  {isMulti && <span className="dock-tab-context-menu-hint">+1</span>}
                  {!isMulti && isVisible && <span className="dock-tab-context-menu-hint">open</span>}
                </button>
              );
            });
          })()}
        </div>
      )}

      {tabContextMenu && (
        <div
          ref={contextMenuRef}
          className="dock-tab-context-menu"
          style={{
            left: tabContextMenu.x,
            top: tabContextMenu.y,
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="dock-tab-context-menu-item"
            type="button"
            onClick={handleFloatContextPanel}
          >
            <span>Float</span>
          </button>
          <button
            className="dock-tab-context-menu-item"
            type="button"
            onClick={handleHideContextPanel}
          >
            <span>Hide</span>
          </button>
          <div className="dock-tab-context-menu-item dock-tab-context-menu-item--submenu">
            <span>Change to</span>
            <span className="dock-tab-context-menu-chevron">&gt;</span>
            <div className="dock-tab-context-submenu">
              {CHANGE_TO_PANEL_TYPES.map((type) => {
                const config = PANEL_CONFIGS[type];
                const isCurrentType = tabContextMenu.panel.type === type;
                const isWip = WIP_PANEL_TYPES.includes(type);
                return (
                  <button
                    key={type}
                    className={`dock-tab-context-menu-item ${isCurrentType ? 'is-current' : ''}`}
                    type="button"
                    disabled={isCurrentType || isWip}
                    onClick={() => handleChangeContextPanelType(type)}
                  >
                    <span>{config.title}</span>
                    {isWip && <span className="dock-tab-context-menu-hint">WIP</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Panel content with zoom */}
      <div
        className={`dock-panel-content ${isActivePanelMaximized ? 'is-maximized-content' : ''}`}
        style={{ '--panel-zoom': panelZoom } as React.CSSProperties}
        onMouseEnter={handlePaneMouseEnter}
        data-guided-panel={activePanel?.type}
        data-panel-type={activePanel?.type}
      >
        <div className={`dock-panel-content-inner ${activePanel ? `dock-panel-content-inner--${activePanel.type}` : ''}`}>
          {activePanel && <DockPanelContent panel={activePanel} />}
        </div>
        {/* Zoom indicator */}
        {panelZoom !== 1.0 && (
          <div className="dock-zoom-indicator">
            {Math.round(panelZoom * 100)}%
          </div>
        )}
      </div>

      {/* Drop zone overlay */}
      {isDropTarget && dropPosition && dropPosition !== 'center' && (
        <div className={`dock-drop-overlay ${dropPosition}`} />
      )}

      {showCenterDropOverlay && (
        <div className="dock-drop-overlay center" />
      )}

      {/* Tab slot indicators when dragging to center/tabs */}
      {showTabSlotOverlay && (
        <div className="dock-tab-slots-overlay" aria-hidden="true">
          {Array.from({ length: group.panels.length + 1 }, (_, index) => (
            <div
              key={`slot-${index}`}
              className={`dock-tab-slot ${dragState.dropTarget?.tabInsertIndex === index ? 'active' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
