// Root dock container - wraps docked panels and renders floating panels

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import {
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  useDockStore,
} from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { SeedanceEditorWorkflowProvider } from '../story/SeedanceEditorWorkflowContext';
import { DockNode } from './DockNode';
import { DetachedPanelWindow } from './DetachedPanelWindow';
import {
  applyDetachedPanelRefreshState,
  takeDetachedPanelsForRefresh,
} from './detachedPanelRefreshState';
import { FloatingPanel } from './FloatingPanel';
import { DockDragPreview } from './container/DockDragPreview';
import { DockRootEdgeDropOverlay } from './container/DockRootEdgeDropOverlay';
import { DockGooOverlay } from './goo/DockGooOverlay';
import { useGooSupport } from './goo/useGooSupport';
import { useDockContainerGlobalDrag } from './container/useDockContainerGlobalDrag';
import { useDockLayoutTransition } from './container/useDockLayoutTransition';
import { useDockMaximizeAnimation } from './container/useDockMaximizeAnimation';
import { useRootEdgeDropTarget } from './container/useRootEdgeDropTarget';
import { useMobilePreviewLayoutFit } from './useMobilePreviewLayoutFit';
import './dock.css';

interface DockContainerProps {
  detachedWindowsReady?: boolean;
}

export function DockContainer({ detachedWindowsReady = true }: DockContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const restoredDetachedRefreshRef = useRef(false);
  const {
    layout,
    browserWindowPanels,
    dragState,
    maximizedPanelId,
    activeSavedLayoutId,
    loadSavedLayout,
  } = useDockStore();
  const theme = useSettingsStore(state => state.theme);
  const previousThemeRef = useRef(theme);
  const getRootEdgeDropTarget = useRootEdgeDropTarget({
    containerRef,
    rootGroupId: layout.root.id,
  });
  const gooEnabled = useGooSupport(dragState.isDragging);
  const rootEdgeDropPosition = dragState.dropTarget?.scope === 'root-edge'
    ? dragState.dropTarget.position
    : null;

  useLayoutEffect(() => {
    if (restoredDetachedRefreshRef.current) return;
    restoredDetachedRefreshRef.current = true;
    const refreshPanels = takeDetachedPanelsForRefresh(window.sessionStorage);
    if (refreshPanels.length === 0) return;

    useDockStore.setState((state) => {
      const restored = applyDetachedPanelRefreshState(
        state.layout,
        state.browserWindowPanels,
        refreshPanels,
      );
      return {
        ...restored,
        hoveredTabTarget: null,
        maximizedPanelId: null,
      };
    });
  }, []);

  useEffect(() => {
    const previousTheme = previousThemeRef.current;
    previousThemeRef.current = theme;
    if (previousTheme === theme || activeSavedLayoutId !== FACTORY_VIDEO_EDIT_LAYOUT_ID) return;

    loadSavedLayout(FACTORY_VIDEO_EDIT_LAYOUT_ID, {
      preserveTimelineLayout: true,
    });
  }, [activeSavedLayoutId, loadSavedLayout, theme]);
  // Drop preview for root-edge targets: shift the whole dock root aside by
  // the strip size so the future layout is visible live.
  const rootPreviewTransform = useMemo(() => {
    switch (rootEdgeDropPosition) {
      case 'left': return 'translateX(min(28%, 340px))';
      case 'right': return 'translateX(max(-28%, -340px))';
      case 'top': return 'translateY(min(28%, 230px))';
      case 'bottom': return 'translateY(max(-28%, -230px))';
      default: return undefined;
    }
  }, [rootEdgeDropPosition]);

  useDockMaximizeAnimation({
    containerRef,
    maximizedPanelId,
  });
  useDockLayoutTransition({
    containerRef,
    layout,
  });
  useDockContainerGlobalDrag({
    getRootEdgeDropTarget,
  });
  useMobilePreviewLayoutFit({ containerRef });

  return (
    <SeedanceEditorWorkflowProvider enabled={activeSavedLayoutId !== FACTORY_START_LAYOUT_ID}>
      <div
        ref={containerRef}
        className={`dock-container ${dragState.isDragging ? 'dragging' : ''} ${gooEnabled && dragState.isDragging ? 'goo-active' : ''} ${maximizedPanelId ? 'is-panel-maximized' : ''}`}
      >
        <div className="dock-root" style={rootPreviewTransform ? { transform: rootPreviewTransform } : undefined}>
          <DockNode node={layout.root} />
        </div>

        <DockRootEdgeDropOverlay
          isDragging={dragState.isDragging}
          position={rootEdgeDropPosition}
        />

        {layout.floatingPanels.map((floating) => (
          <FloatingPanel key={floating.id} floating={floating} />
        ))}

        {browserWindowPanels.map((windowPanel) => (
          <DetachedPanelWindow
            key={windowPanel.id}
            restoreReady={detachedWindowsReady}
            windowPanel={windowPanel}
          />
        ))}

        {gooEnabled ? <DockGooOverlay /> : <DockDragPreview dragState={dragState} />}
      </div>
    </SeedanceEditorWorkflowProvider>
  );
}
