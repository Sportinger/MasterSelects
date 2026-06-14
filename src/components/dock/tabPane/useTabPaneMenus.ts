import { useCallback, useEffect, useRef, useState } from 'react';

import type { BrowserWindowPanel, DockPanel, PanelType } from '../../../types/dock';
import { clampMenuPosition } from './layoutMath';

export interface DockTabContextMenuState {
  x: number;
  y: number;
  panel: DockPanel;
}

interface UseTabPaneMenusArgs {
  groupId: string;
  cancelHold: () => void;
  closePanelById: (panelId: string) => void;
  changePanelType: (panelId: string, type: PanelType) => void;
  addPanelTypeToGroup: (type: PanelType, groupId: string) => void;
  floatPanel: (panelId: string, groupId: string, position: { x: number; y: number }) => void;
  detachPanelToBrowserWindow: (panelId: string, groupId: string) => BrowserWindowPanel | null;
}

export function useTabPaneMenus({
  groupId,
  cancelHold,
  closePanelById,
  changePanelType,
  addPanelTypeToGroup,
  floatPanel,
  detachPanelToBrowserWindow,
}: UseTabPaneMenusArgs) {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [tabContextMenu, setTabContextMenu] = useState<DockTabContextMenuState | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);

  const openTabContextMenu = useCallback((event: React.MouseEvent, panel: DockPanel) => {
    event.preventDefault();
    event.stopPropagation();
    cancelHold();
    setTabContextMenu({
      ...clampMenuPosition(event.clientX, event.clientY, 430, 180),
      panel,
    });
  }, [cancelHold]);

  const handleHideContextPanel = useCallback(() => {
    if (!tabContextMenu) return;
    closePanelById(tabContextMenu.panel.id);
    setTabContextMenu(null);
  }, [closePanelById, tabContextMenu]);

  const handleFloatContextPanel = useCallback(() => {
    if (!tabContextMenu) return;
    const x = Math.max(12, Math.min(window.innerWidth - 420, tabContextMenu.x));
    const y = Math.max(12, Math.min(window.innerHeight - 320, tabContextMenu.y));
    floatPanel(tabContextMenu.panel.id, groupId, { x, y });
    setTabContextMenu(null);
  }, [floatPanel, groupId, tabContextMenu]);

  const handleDetachContextPanelToWindow = useCallback(() => {
    if (!tabContextMenu) return;
    detachPanelToBrowserWindow(tabContextMenu.panel.id, groupId);
    setTabContextMenu(null);
  }, [detachPanelToBrowserWindow, groupId, tabContextMenu]);

  const handleChangeContextPanelType = useCallback((type: PanelType) => {
    if (!tabContextMenu) return;
    changePanelType(tabContextMenu.panel.id, type);
    setTabContextMenu(null);
  }, [changePanelType, tabContextMenu]);

  const handleAddButtonClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 2 }));
  }, []);

  const handleAddPanelType = useCallback((type: PanelType) => {
    addPanelTypeToGroup(type, groupId);
    setAddMenu(null);
  }, [addPanelTypeToGroup, groupId]);

  useEffect(() => {
    if (!addMenu) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setAddMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddMenu(null);
    };
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

  return {
    contextMenuRef,
    addMenuRef,
    tabContextMenu,
    addMenu,
    openTabContextMenu,
    handleHideContextPanel,
    handleFloatContextPanel,
    handleDetachContextPanelToWindow,
    handleChangeContextPanelType,
    handleAddButtonClick,
    handleAddPanelType,
  };
}
