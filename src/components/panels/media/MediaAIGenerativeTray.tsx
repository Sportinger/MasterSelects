import { useCallback, useState, type SyntheticEvent } from 'react';
import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
  DEFAULT_FLASHBOARD_PROVIDER_ID,
  DEFAULT_FLASHBOARD_SERVICE,
} from '../../../stores/flashboardStore/defaults';
import { FlashBoardComposer } from '../flashboard/FlashBoardComposer';
import { useFlashBoardRuntime } from '../flashboard/useFlashBoardRuntime';
import { MediaAIGenerationQueue } from './MediaAIGenerationQueue';
import { useAccountStore } from '../../../stores/accountStore';
import '../flashboard/FlashBoard.css';
import './MediaAIGenerativeTray.css';

const MEDIA_GENERATIVE_SERVICES: Array<'cloud' | 'kieai' | 'evolink' | 'elevenlabs' | 'suno'> = [
  'cloud',
  'kieai',
  'evolink',
  'elevenlabs',
  'suno',
];

type MediaAITrayMode = 'generate' | 'chat';

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
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const useHostedDefaults = Boolean(accountSession?.authenticated && hostedAIEnabled);

  const stopEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation();
  }, []);

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
            title="Expand AI prompt"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
              <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
            </svg>
            <span>Generate</span>
          </button>
        </div>
      )}
      <div
        className={`media-ai-tray media-ai-tray-expanded ${expanded ? '' : 'is-collapsed'}`}
        onMouseDown={stopEvent}
        onClick={stopEvent}
        aria-hidden={!expanded}
      >
        <MediaAIGenerationQueue />
        <button
          className="media-ai-tray-collapse"
          type="button"
          onClick={() => onExpandedChange(false)}
          title="Collapse AI prompt"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 6h8" />
          </svg>
        </button>
        <FlashBoardComposer
          initialProviderId={DEFAULT_FLASHBOARD_PROVIDER_ID}
          initialService={useHostedDefaults ? 'cloud' : DEFAULT_FLASHBOARD_SERVICE}
          initialVersion={useHostedDefaults ? 'latest' : DEFAULT_FLASHBOARD_MODEL_VERSION}
          initialMode={trayMode}
          allowedServices={MEDIA_GENERATIVE_SERVICES}
        />
      </div>
    </>
  );
}
