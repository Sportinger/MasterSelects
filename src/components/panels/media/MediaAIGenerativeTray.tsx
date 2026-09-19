import { lazy, Suspense, useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useDockStore } from '../../../stores/dockStore';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import {
  subscribeLandingEntryRequests,
  takeLandingEntryRequest,
  type LandingEntryRequest,
} from '../../../marketing/landingEntryRequest';
import './MediaAIGenerativeTray.css';

const importExpandedTray = () => import('./MediaAIGenerativeTrayExpanded');
const MediaAIGenerativeTrayExpanded = lazy(() =>
  importExpandedTray().then((module) => ({ default: module.MediaAIGenerativeTrayExpanded })),
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
  const activatePanelType = useDockStore((state) => state.activatePanelType);
  const [trayMode, setTrayMode] = useState<MediaAITrayMode>('generate');
  const [landingRequest, setLandingRequest] = useState<LandingEntryRequest | null>(null);

  const stopEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  const prefetchExpanded = useCallback(() => {
    void importExpandedTray();
  }, []);

  const prefetchStudio = useCallback(() => {
    void import('../ai-studio/AIStudioPanel');
  }, []);

  const openTray = useCallback((mode: MediaAITrayMode) => {
    setTrayMode(mode);
    setLandingRequest(null);
    onExpandedChange(true);
  }, [onExpandedChange]);

  const openStudio = useCallback(() => {
    activatePanelType('ai-studio');
    onExpandedChange(false);
  }, [activatePanelType, onExpandedChange]);

  const applyLandingRequest = useCallback((request: LandingEntryRequest) => {
    if (request.mode === 'generate' && request.providerId && request.outputType) {
      useFlashBoardStore.setState((state) => ({
        composer: {
          ...state.composer,
          outputType: request.outputType,
          providerId: request.providerId,
          service: request.service ?? 'cloud',
          version: 'latest',
        },
      }));
    }

    setLandingRequest(request);
    setTrayMode(request.mode);
    onExpandedChange(true);
  }, [onExpandedChange]);

  useEffect(() => {
    const pendingRequest = takeLandingEntryRequest();
    let cancelled = false;
    if (pendingRequest) queueMicrotask(() => {
      if (!cancelled) applyLandingRequest(pendingRequest);
    });

    const unsubscribe = subscribeLandingEntryRequests((request) => {
      takeLandingEntryRequest();
      applyLandingRequest(request);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [applyLandingRequest]);

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
            className="media-ai-tray-launch media-ai-tray-launch-studio"
            type="button"
            onClick={openStudio}
            onMouseEnter={prefetchStudio}
            title="Open AI Studio"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" />
              <path d="M5.2 5.4h5.6M5.2 8h3.9M5.2 10.6h5.6" />
            </svg>
            <span>Studio</span>
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
              key={landingRequest?.id ?? trayMode}
              mode={trayMode}
              initialChatPrompt={landingRequest?.mode === 'chat' ? landingRequest.prompt : undefined}
              onCollapse={() => onExpandedChange(false)}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
