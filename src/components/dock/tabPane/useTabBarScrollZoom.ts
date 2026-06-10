import { useCallback, useEffect, useRef, useState } from 'react';

import type { DockLayout, DockPanel } from '../../../types/dock';

interface UseTabBarScrollZoomArgs {
  tabBarRef: React.RefObject<HTMLDivElement | null>;
  activePanel: DockPanel | undefined;
  layout: DockLayout;
  setPanelZoom: (panelId: string, zoom: number) => void;
}

export function useTabBarScrollZoom({
  tabBarRef,
  activePanel,
  layout,
  setPanelZoom,
}: UseTabBarScrollZoomArgs) {
  const [isMiddleDragging, setIsMiddleDragging] = useState(false);
  const middleDragStartRef = useRef<{ x: number; scrollLeft: number } | null>(null);

  useEffect(() => {
    const tabBar = tabBarRef.current;
    if (!tabBar) return undefined;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !activePanel) return;

      event.preventDefault();
      event.stopPropagation();

      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const currentZoom = layout.panelZoom?.[activePanel.id] ?? 1.0;
      setPanelZoom(activePanel.id, currentZoom + delta);
    };

    tabBar.addEventListener('wheel', handleWheel, { passive: false });
    return () => tabBar.removeEventListener('wheel', handleWheel);
  }, [activePanel, layout.panelZoom, setPanelZoom, tabBarRef]);

  const handleTabBarMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 1) return;
    event.preventDefault();

    const tabBar = tabBarRef.current;
    if (!tabBar) return;

    setIsMiddleDragging(true);
    middleDragStartRef.current = {
      x: event.clientX,
      scrollLeft: tabBar.scrollLeft,
    };
  }, [tabBarRef]);

  useEffect(() => {
    if (!isMiddleDragging) return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const tabBar = tabBarRef.current;
      if (!tabBar || !middleDragStartRef.current) return;

      const deltaX = event.clientX - middleDragStartRef.current.x;
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
  }, [isMiddleDragging, tabBarRef]);

  return {
    isMiddleDragging,
    handleTabBarMouseDown,
  };
}
