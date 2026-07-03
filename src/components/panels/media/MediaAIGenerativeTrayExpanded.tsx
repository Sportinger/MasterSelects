import {
  DEFAULT_FLASHBOARD_PROVIDER_ID,
} from '../../../stores/flashboardStore/defaults';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { useAccountStore } from '../../../stores/accountStore';
import { FlashBoardComposer } from '../flashboard/FlashBoardComposer';
import { MediaDownloadComposer } from './MediaDownloadComposer';
import { MediaAIGenerationQueue } from './MediaAIGenerationQueue';
import '../flashboard/FlashBoard.css';

const MEDIA_GENERATIVE_SERVICES: Array<'cloud'> = [
  'cloud',
];

interface MediaAIGenerativeTrayExpandedProps {
  mode: 'generate' | 'chat' | 'download';
  onCollapse: () => void;
}

function getHostedInitialProviderId(service: string | undefined, providerId: string | undefined): string {
  if (service === 'kieai' && providerId === 'kling-3.0') {
    return 'cloud-kling';
  }

  if (service === 'elevenlabs' && providerId === 'elevenlabs-tts') {
    return 'cloud-elevenlabs-tts';
  }

  return providerId ?? DEFAULT_FLASHBOARD_PROVIDER_ID;
}

export function MediaAIGenerativeTrayExpanded({
  mode,
  onCollapse,
}: MediaAIGenerativeTrayExpandedProps) {
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const flashBoardComposer = useFlashBoardStore((s) => s.composer);
  const useHostedDefaults = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const initialProviderId = getHostedInitialProviderId(flashBoardComposer.service, flashBoardComposer.providerId);

  return (
    <>
      <MediaAIGenerationQueue />
      <button
        className="media-ai-tray-collapse"
        type="button"
        onClick={onCollapse}
        title="Collapse AI prompt"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M4 6h8" />
        </svg>
      </button>
      {mode === 'download' ? (
        <MediaDownloadComposer />
      ) : (
        <FlashBoardComposer
          initialProviderId={initialProviderId}
          initialService="cloud"
          initialVersion={useHostedDefaults ? 'latest' : flashBoardComposer.version}
          initialMode={mode}
          allowedServices={MEDIA_GENERATIVE_SERVICES}
        />
      )}
    </>
  );
}
