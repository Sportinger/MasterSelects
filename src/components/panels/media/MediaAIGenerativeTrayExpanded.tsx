import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
  DEFAULT_FLASHBOARD_PROVIDER_ID,
  DEFAULT_FLASHBOARD_SERVICE,
} from '../../../stores/flashboardStore/defaults';
import { useAccountStore } from '../../../stores/accountStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { FlashBoardComposer } from '../flashboard/FlashBoardComposer';
import { MediaDownloadComposer } from './MediaDownloadComposer';
import { MediaAIGenerationQueue } from './MediaAIGenerationQueue';
import '../flashboard/FlashBoard.css';

const MEDIA_GENERATIVE_SERVICES: Array<'cloud' | 'kieai' | 'evolink' | 'elevenlabs' | 'suno'> = [
  'cloud',
  'kieai',
  'evolink',
  'elevenlabs',
  'suno',
];

interface MediaAIGenerativeTrayExpandedProps {
  mode: 'generate' | 'chat' | 'download';
  onCollapse: () => void;
}

export function MediaAIGenerativeTrayExpanded({
  mode,
  onCollapse,
}: MediaAIGenerativeTrayExpandedProps) {
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const useKieAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.kieai && apiKeys.kieai.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const useCloudDefaults = useHostedProductionProviders || !useKieAiKeyByDefault;
  const useHostedDefaults = Boolean(accountSession?.authenticated && hostedAIEnabled && useCloudDefaults);

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
          initialProviderId={DEFAULT_FLASHBOARD_PROVIDER_ID}
          initialService={useCloudDefaults ? 'cloud' : DEFAULT_FLASHBOARD_SERVICE}
          initialVersion={useHostedDefaults ? 'latest' : DEFAULT_FLASHBOARD_MODEL_VERSION}
          initialMode={mode}
          allowedServices={MEDIA_GENERATIVE_SERVICES}
        />
      )}
    </>
  );
}
