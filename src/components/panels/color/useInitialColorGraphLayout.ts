import { useCallback, useEffect, type RefObject } from 'react';

interface InitialColorGraphLayoutOptions {
  canvasRef: RefObject<HTMLDivElement | null>;
  clipId: string;
  enabled: boolean;
  initialize: (clipId: string, width: number, height: number) => void;
  setViewport: (
    clipId: string,
    viewport: { x: number; y: number; zoom: number },
  ) => void;
}

export function useInitialColorGraphLayout({
  canvasRef,
  clipId,
  enabled,
  initialize,
  setViewport,
}: InitialColorGraphLayoutOptions) {
  const ensureInitialLayout = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      initialize(clipId, rect.width, rect.height);
    }
  }, [canvasRef, clipId, initialize]);

  const resetViewport = useCallback(() => {
    setViewport(clipId, { x: 0, y: 0, zoom: 1 });
  }, [clipId, setViewport]);

  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      ensureInitialLayout();
      resetViewport();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, ensureInitialLayout, resetViewport]);

  return resetViewport;
}
