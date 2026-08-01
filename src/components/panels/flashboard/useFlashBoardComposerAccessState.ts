import { useAccountStore } from '../../../stores/accountStore';
import { useSettingsStore } from '../../../stores/settingsStore';

function normalizeApiKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function useFlashBoardComposerAccessState() {
  const piApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.piapi));
  const evolinkApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.evolink));
  const elevenLabsApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.elevenlabs));
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const aiSystemPromptOverrides = useSettingsStore((s) => s.aiSystemPromptOverrides);
  const aiSystemPromptSendContext = useSettingsStore((s) => s.aiSystemPromptSendContext);
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const lemonadeContextSize = useSettingsStore((s) => s.lemonadeContextSize);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const lemonadeModel = useSettingsStore((s) => s.lemonadeModel);
  const setAiProvider = useSettingsStore((s) => s.setAiProvider);
  const setAiSystemPromptOverride = useSettingsStore((s) => s.setAiSystemPromptOverride);
  const setAiSystemPromptSendContext = useSettingsStore((s) => s.setAiSystemPromptSendContext);
  const setLemonadeContextSize = useSettingsStore((s) => s.setLemonadeContextSize);
  const setLemonadeModel = useSettingsStore((s) => s.setLemonadeModel);
  const usePiApiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.piapi && piApiKey.trim());
  const useEvolinkKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.evolink && evolinkApiKey.trim());
  const useElevenLabsKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.elevenlabs && elevenLabsApiKey.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = accountSession?.authenticated === true;
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseHostedPromptRefiner = Boolean(accountSession?.authenticated && hostedAIEnabled);

  return {
    accountSession,
    aiProvider,
    aiSystemPromptSendContext,
    aiSystemPromptOverrides,
    canUseHostedPromptRefiner,
    elevenLabsApiKey,
    hasElevenLabsKey: useElevenLabsKeyByDefault,
    hasEvolinkKey: useEvolinkKeyByDefault,
    hasHostedAudioAccess,
    hasHostedSession,
    hostedAIEnabled,
    lemonadeContextSize,
    lemonadeEndpoint,
    lemonadeModel,
    openAuthDialog,
    openPricingDialog,
    setAiProvider,
    setAiSystemPromptOverride,
    setAiSystemPromptSendContext,
    setLemonadeContextSize,
    setLemonadeModel,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    usePiApiKeyByDefault,
  };
}
