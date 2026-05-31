import { lazy, Suspense, useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useFlashBoardRuntime } from '../flashboard/useFlashBoardRuntime';
import './MediaAIGenerativeTray.css';

// Shared factory so we can both lazy-render and prefetch the (heavy) expanded
// tray chunk. Module imports are cached, so calling this repeatedly is cheap.
const importExpandedTray = () => import('./MediaAIGenerativeTrayExpanded');
const MediaAIGenerativeTrayExpanded = lazy(() =>
  importExpandedTray().then((m) => ({ default: m.MediaAIGenerativeTrayExpanded }))
);

type MediaAITrayMode = 'generate' | 'chat' | 'download';

interface MediaAIGenerativeTrayProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function MediaAIGenerativeTray({
  expanded,
  onExpandedChange,
}: MediaAIGenerativeTrayProps) {
  useFlashBoardRuntime({ enableKeyboardDelete: false });
  const [trayMode, setTrayMode] = useState<MediaAITrayMode>('generate');

  const stopEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  // Warm the heavy expanded chunk while collapsed (on idle), and on button
  // hover, so the first expand doesn't pay the parse cost on the click (#199).
  const prefetchExpanded = useCallback(() => {
    void importExpandedTray();
  }, []);

  useEffect(() => {
    if (expanded) return undefined;
    let cancelled = false;
    const warm = () => { if (!cancelled) prefetchExpanded(); };
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(warm);
      return () => { cancelled = true; win.cancelIdleCallback?.(id); };
    }
    const id = window.setTimeout(warm, 200);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [expanded, prefetchExpanded]);

  const openTray = useCallback((mode: MediaAITrayMode) => {
    setTrayMode(mode);
    onExpandedChange(true);
  }, [onExpandedChange]);

  return (
    <>
      {!expanded && (
        <div className="media-ai-tray media-ai-tray-collapsed" onMouseDown={stopEvent} onClick={stopEvent}>
          <button
            className="media-ai-tray-launch media-ai-tray-launch-chat"
            type="button"
            onClick={() => openTray('chat')}
            onMouseEnter={prefetchExpanded}
            title="Open AI chat"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M3.4 3.5h9.2a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H7.2L3.6 14v-2.5h-.2a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8Z" />
              <path d="M5 6.5h6M5 8.9h4" />
            </svg>
            <span>Chat</span>
          </button>
          <button
            className="media-ai-tray-launch"
            type="button"
            onClick={() => openTray('generate')}
            onMouseEnter={prefetchExpanded}
            title="Expand AI prompt"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
              <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
            </svg>
            <span>Generate</span>
          </button>
          <button
            className="media-ai-tray-launch media-ai-tray-launch-download"
            type="button"
            onClick={() => openTray('download')}
            onMouseEnter={prefetchExpanded}
            title="Open downloads"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M8 2v7" />
              <path d="m4.8 6.5 3.2 3.2 3.2-3.2" />
              <path d="M3 12.8h10" />
            </svg>
            <span>Downloads</span>
          </button>
        </div>
      )}
      {expanded && (
        <div
          className="media-ai-tray media-ai-tray-expanded"
          onMouseDown={stopEvent}
          onClick={stopEvent}
        >
          <Suspense fallback={<div className="media-ai-tray-loading" />}>
            <MediaAIGenerativeTrayExpanded
              mode={trayMode}
              onCollapse={() => onExpandedChange(false)}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
