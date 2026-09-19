// Tab group container with tab bar and panel content

import { useCallback, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { DockPanel, DockTabGroup } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { selectIsSlotGridPanelActive, useSlotGridPanelStore } from '../../stores/slotGridPanelStore';
import { useTimelineStore } from '../../stores/timeline';
import { DockDropOverlays } from './tabPane/DockDropOverlays';
import { DockTabDoubleTouchTracker } from './tabPane/DockTabDoubleTouchTracker';
import { DockTabMenus } from './tabPane/DockTabMenus';
import { DockTabStrip } from './tabPane/DockTabStrip';
import { PanelContentHost } from './tabPane/PanelContentHost';
import { pluralize } from './tabPane/layoutMath';
import { useCompositionTabReorder } from './tabPane/useCompositionTabReorder';
import { useDockPaneHover } from './tabPane/useDockPaneHover';
import { useDockTabHoldDrag } from './tabPane/useDockTabHoldDrag';
import { useTabBarScrollZoom } from './tabPane/useTabBarScrollZoom';
import { useDockPanelTabSwipe } from './tabPane/useDockPanelTabSwipe';
import { useTabPaneMenus } from './tabPane/useTabPaneMenus';

interface DockTabPaneProps {
  group: DockTabGroup;
}

export function DockTabPane({ group }: DockTabPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const suppressNextTabClickRef = useRef(false);
  const doubleTouchTrackerRef = useRef<DockTabDoubleTouchTracker | null>(null);
  doubleTouchTrackerRef.current ??= new DockTabDoubleTouchTracker();

  const {
    setActiveTab,
    startDrag,
    dragState,
    setPanelZoom,
    layout,
    activatePanelType,
    closePanelById,
    changePanelType,
    addPanelTypeToGroup,
    floatPanel,
    detachPanelToBrowserWindow,
    getVisiblePanelTypes,
    hoveredTabTarget,
    setHoveredTabTarget,
    clearHoveredTabTarget,
    maximizedPanelId,
    setMaximizedPanel,
  } = useDockStore(useShallow(s => ({
    setActiveTab: s.setActiveTab,
    startDrag: s.startDrag,
    dragState: s.dragState,
    setPanelZoom: s.setPanelZoom,
    layout: s.layout,
    activatePanelType: s.activatePanelType,
    closePanelById: s.closePanelById,
    changePanelType: s.changePanelType,
    addPanelTypeToGroup: s.addPanelTypeToGroup,
    floatPanel: s.floatPanel,
    detachPanelToBrowserWindow: s.detachPanelToBrowserWindow,
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
    reorderCompositionTabs,
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
  const audioMixerWoodThemeEnabled = useSettingsStore(state => state.audioMixerWoodThemeEnabled);
  const slotGridPanelActive = useSlotGridPanelStore(selectIsSlotGridPanelActive);

  const activePanel = group.panels[group.activeIndex];
  const isAudioMixerWoodPane = activePanel?.type === 'audio-mixer' && audioMixerWoodThemeEnabled;
  const isDropTarget = dragState.dropTarget?.scope !== 'root-edge' && dragState.dropTarget?.groupId === group.id;
  const dropPosition = isDropTarget ? dragState.dropTarget?.position : undefined;
  // Slides the pane's inner box aside while a zone is hovered so the user
  // sees the post-drop layout. Never transform the pane element itself: its
  // untransformed hit box is what the drag hit-testing samples.
  const dropPreviewPosition = isDropTarget && dropPosition ? dropPosition : undefined;
  const showTabSlotOverlay = isDropTarget && dropPosition === 'center' && dragState.dropTarget?.tabInsertIndex !== undefined;
  const showCenterDropOverlay = isDropTarget && dropPosition === 'center';
  const panelZoom = activePanel ? (layout.panelZoom?.[activePanel.id] ?? 1.0) : 1.0;
  const timelinePanel = useMemo(() => group.panels.find((panel) => panel.type === 'timeline') ?? null, [group.panels]);
  const hoveredPanelId = hoveredTabTarget?.panelId ?? null;
  const groupContainsMaximizedPanel = maximizedPanelId !== null && group.panels.some((panel) => panel.id === maximizedPanelId);
  const isActivePanelMaximized = activePanel?.id === maximizedPanelId;
  const layoutAnimationId = activePanel ? `panel:${activePanel.id}` : `group:${group.id}`;
  const hasTimelinePanel = timelinePanel !== null;
  const openCompositions = hasTimelinePanel ? getOpenCompositions() : [];

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
    if (propertiesSelection?.kind === 'transition') {
      const clip = clips.find(item => item.id === propertiesSelection.clipId);
      const transition = propertiesSelection.edge === 'in'
        ? clip?.transitionIn
        : clip?.transitionOut;
      return transition ? `TRANSITION ${transition.type}` : null;
    }
    if (propertiesSelection?.kind === 'track') {
      const track = tracks.find(item => item.id === propertiesSelection.trackId);
      return track ? `TRACK ${track.name}` : null;
    }
    if (propertiesSelection?.kind === 'master') {
      return 'MASTER Master';
    }
    return selectedClipName ? `CLIP ${selectedClipName}` : null;
  }, [clips, propertiesSelection, selectedClipName, tracks]);
  const selectedSlotName = useMemo(() => {
    if (!slotGridPanelActive || !selectedSlotCompositionId) {
      return null;
    }

    return compositions.find((comp) => comp.id === selectedSlotCompositionId)?.name || null;
  }, [compositions, selectedSlotCompositionId, slotGridPanelActive]);
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

  const holdDrag = useDockTabHoldDrag({
    groupId: group.id,
    startDrag,
  });
  const compositionTabs = useCompositionTabReorder({
    holdProgress: holdDrag.holdProgress,
    reorderCompositionTabs,
  });
  const tabBarInteractions = useTabBarScrollZoom({
    tabBarRef,
    activePanel,
    layout,
    setPanelZoom,
  });
  const menus = useTabPaneMenus({
    groupId: group.id,
    cancelHold: holdDrag.cancelHold,
    closePanelById,
    changePanelType,
    addPanelTypeToGroup,
    floatPanel,
    detachPanelToBrowserWindow,
  });

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
  const paneHover = useDockPaneHover({
    dragState,
    clearHoveredTabTarget,
    handlePaneMouseEnter,
  });

  const handleTabClick = useCallback((index: number) => {
    if (suppressNextTabClickRef.current) {
      suppressNextTabClickRef.current = false;
      return;
    }
    setActiveTab(group.id, index);
    if (groupContainsMaximizedPanel) {
      setMaximizedPanel(group.panels[index]?.id ?? null);
    }
  }, [group.id, group.panels, groupContainsMaximizedPanel, setActiveTab, setMaximizedPanel]);
  const panelTabSwipe = useDockPanelTabSwipe({
    activeIndex: group.activeIndex,
    panelCount: group.panels.length,
    onSelect: handleTabClick,
  });

  const handleTabPointerDown = useCallback((event: React.PointerEvent, panel: DockPanel, index: number) => {
    suppressNextTabClickRef.current = false;
    doubleTouchTrackerRef.current?.pointerDown({
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      isPrimary: event.isPrimary,
      panelId: panel.id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
    holdDrag.notePointerDown(event.pointerType);
    if (event.button !== 0 || !event.isPrimary) return;
    // A coarse pointer is selected by the eventual click. Deferring this lets
    // a long-press open/drag the tab without activating an inactive panel.
    if (event.pointerType === 'mouse') {
      setActiveTab(group.id, index);
    }
    holdDrag.startHold(panel.id, panel, event.currentTarget as HTMLElement, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
  }, [group.id, holdDrag, setActiveTab]);

  const handleTabContextMenu = useCallback((event: React.MouseEvent, panel: DockPanel, _index: number) => {
    suppressNextTabClickRef.current = true;
    if (holdDrag.isTouchPointerDown()) {
      event.preventDefault();
      return;
    }
    menus.openTabContextMenu(event, panel);
  }, [holdDrag, menus]);

  const handleTabPointerUp = useCallback((event: React.PointerEvent, panel: DockPanel, _index: number) => {
    holdDrag.cancelHoldIfHolding();
    const isDoubleTouch = doubleTouchTrackerRef.current?.pointerUp({
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      isPrimary: event.isPrimary,
      panelId: panel.id,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
    if (holdDrag.holdProgress === 'ready' || dragState.isDragging) {
      suppressNextTabClickRef.current = true;
      return;
    }
    if (!isDoubleTouch) return;

    suppressNextTabClickRef.current = true;
    menus.openTabContextMenu(event, panel);
  }, [
    dragState.isDragging,
    holdDrag,
    menus,
  ]);

  const handleTabPointerCancel = useCallback((event: React.PointerEvent) => {
    doubleTouchTrackerRef.current?.cancel(event.pointerId);
    holdDrag.cancelHoldIfHolding();
  }, [holdDrag]);

  const handlePanelTabMouseEnter = useCallback((panel: DockPanel) => {
    setHoveredTabTarget({
      kind: 'panel',
      panelId: panel.id,
      groupId: group.id,
    });
  }, [group.id, setHoveredTabTarget]);

  const handlePanelTabMouseLeave = useCallback((panelId: string) => {
    clearHoveredTabTarget(panelId);
  }, [clearHoveredTabTarget]);

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

  const handleTabBarContextMenu = useCallback((event: React.MouseEvent) => {
    if (holdDrag.isTouchPointerDown() && holdDrag.holdProgress !== 'idle') {
      event.preventDefault();
      return;
    }
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
    menus.openTabContextMenu(event, timelinePanel);
  }, [
    group.id,
    group.panels,
    groupContainsMaximizedPanel,
    hasTimelinePanel,
    holdDrag,
    menus,
    setActiveTab,
    setMaximizedPanel,
    timelinePanel,
  ]);

  const handleTimelineHandlePointerDown = useCallback((event: React.PointerEvent) => {
    holdDrag.notePointerDown(event.pointerType);
    if (event.button !== 0 || !event.isPrimary || !timelinePanel) return;
    holdDrag.startHold('timeline-handle', timelinePanel, event.currentTarget as HTMLElement, {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    });
  }, [holdDrag, timelinePanel]);

  // The ⋮⋮ reposition handle also carries the panel context menu (hide,
  // detach, replace, …) because the timeline group's tabs belong to the
  // compositions and offer no panel tab to right-click.
  const handleTimelineHandleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!timelinePanel) return;
    const timelinePanelIndex = group.panels.findIndex((panel) => panel.id === timelinePanel.id);
    if (timelinePanelIndex >= 0) {
      setActiveTab(group.id, timelinePanelIndex);
    }
    menus.openTabContextMenu(event, timelinePanel);
  }, [group.id, group.panels, menus, setActiveTab, timelinePanel]);

  const handleCompositionClick = useCallback((compositionId: string) => {
    setActiveComposition(compositionId);
    activatePanelType('media');
  }, [activatePanelType, setActiveComposition]);

  const handleCompositionClose = useCallback((compositionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    closeCompositionTab(compositionId);
  }, [closeCompositionTab]);

  return (
    <div
      ref={containerRef}
      className={`dock-tab-pane ${isDropTarget ? 'drop-target' : ''} ${groupContainsMaximizedPanel ? 'is-maximized-pane' : ''} ${isAudioMixerWoodPane ? 'audio-mixer-wood-pane' : ''}`}
      data-group-id={group.id}
      data-guided-target={`pane:${group.id}`}
      data-active-panel-type={activePanel?.type}
      data-drop-preview={dropPreviewPosition}
      data-dock-layout-anim-id={layoutAnimationId}
      data-dock-layout-anim-title={activePanel?.title ?? group.id}
      onMouseEnter={handlePaneMouseEnter}
      onMouseMove={paneHover.handleMouseMove}
      onMouseLeave={paneHover.handleMouseLeave}
    >
      <div className="dock-pane-preview-box">
        <DockTabStrip
          group={group}
          tabBarRef={tabBarRef}
          isMiddleDragging={tabBarInteractions.isMiddleDragging}
          groupContainsMaximizedPanel={groupContainsMaximizedPanel}
          hasTimelinePanel={hasTimelinePanel}
          timelinePanel={timelinePanel}
          openCompositions={openCompositions}
          slotGridProgress={slotGridProgress}
          holdingTabId={holdDrag.holdingTabId}
          holdProgress={holdDrag.holdProgress}
          draggedCompIndex={compositionTabs.draggedCompIndex}
          dropTargetIndex={compositionTabs.dropTargetIndex}
          activeCompositionId={activeCompositionId}
          hoveredTabTarget={hoveredTabTarget}
          hoveredPanelId={hoveredPanelId}
          maximizedPanelId={maximizedPanelId}
          dragState={dragState}
          selectedSlotName={selectedSlotName}
          selectedPropertiesName={selectedPropertiesName}
          audioMixerTabStats={audioMixerTabStats}
          addMenuOpen={menus.addMenu !== null}
          onTabBarMouseDown={tabBarInteractions.handleTabBarMouseDown}
          onTabBarContextMenu={handleTabBarContextMenu}
          onTimelineHandlePointerDown={handleTimelineHandlePointerDown}
          onTimelineHandleContextMenu={handleTimelineHandleContextMenu}
          onTimelineHandlePointerUp={holdDrag.cancelHoldIfHolding}
          onTimelineHandlePointerLeave={holdDrag.cancelHoldIfHolding}
          onCompositionClick={handleCompositionClick}
          onCompositionClose={handleCompositionClose}
          onCompositionTabMouseEnter={handleCompositionTabMouseEnter}
          onCompositionTabMouseLeave={handleCompositionTabMouseLeave}
          compositionTabHandlers={{
            onDragStart: compositionTabs.handleCompDragStart,
            onDragOver: compositionTabs.handleCompDragOver,
            onDragLeave: compositionTabs.handleCompDragLeave,
            onDrop: compositionTabs.handleCompDrop,
            onDragEnd: compositionTabs.handleCompDragEnd,
          }}
          onTabClick={handleTabClick}
          onTabPointerDown={handleTabPointerDown}
          onTabContextMenu={handleTabContextMenu}
          onTabPointerUp={handleTabPointerUp}
          onTabPointerLeave={handleTabPointerCancel}
          onTabPointerCancel={handleTabPointerCancel}
          onPanelTabMouseEnter={handlePanelTabMouseEnter}
          onPanelTabMouseLeave={handlePanelTabMouseLeave}
          onAddButtonClick={menus.handleAddButtonClick}
        />

        <PanelContentHost
          activePanel={activePanel}
          panelZoom={panelZoom}
          isActivePanelMaximized={isActivePanelMaximized}
          onPaneMouseEnter={handlePaneMouseEnter}
          tabSwipeHandlers={panelTabSwipe.handlers}
          tabSwipeMotionClass={panelTabSwipe.motionClass}
          suppressTabSwipeContentInteractions={panelTabSwipe.suppressContentInteractions}
        />
      </div>

      <DockTabMenus
        addMenuRef={menus.addMenuRef}
        contextMenuRef={menus.contextMenuRef}
        addMenu={menus.addMenu}
        tabContextMenu={menus.tabContextMenu}
        getVisiblePanelTypes={getVisiblePanelTypes}
        onAddPanelType={menus.handleAddPanelType}
        onHideContextPanel={menus.handleHideContextPanel}
        onFloatContextPanel={menus.handleFloatContextPanel}
        onDetachContextPanelToWindow={menus.handleDetachContextPanelToWindow}
        onChangeContextPanelType={menus.handleChangeContextPanelType}
      />

      <DockDropOverlays
        isDropTarget={isDropTarget}
        dropPosition={dropPosition}
        showCenterDropOverlay={showCenterDropOverlay}
        showTabSlotOverlay={showTabSlotOverlay}
        panelCount={group.panels.length}
        dragState={dragState}
      />
    </div>
  );
}
