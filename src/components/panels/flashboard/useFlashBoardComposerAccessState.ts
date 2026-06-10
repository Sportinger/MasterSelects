import { useAccountStore } from '../../../stores/accountStore';
import { useSettingsStore } from '../../../stores/settingsStore';

function normalizeApiKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function useFlashBoardComposerAccessState() {
  const openAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.openai));
  const anthropicApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.anthropic));
  const piApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.piapi));
  const kieAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.kieai));
  const evolinkApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.evolink));
  const elevenLabsApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.elevenlabs));
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const aiApprovalMode = useSettingsStore((s) => s.aiApprovalMode);
  const setAiApprovalMode = useSettingsStore((s) => s.setAiApprovalMode);
  const useOpenAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.openai && openAiApiKey.trim());
  const useAnthropicKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.anthropic && anthropicApiKey.trim());
  const usePiApiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.piapi && piApiKey.trim());
  const useKieAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.kieai && kieAiApiKey.trim());
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
  const canUseByoPromptRefiner = !useHostedProductionProviders && useOpenAiKeyByDefault;

  return {
    accountSession,
    aiApprovalMode,
    anthropicApiKey,
    canUseByoPromptRefiner,
    canUseHostedPromptRefiner,
    elevenLabsApiKey,
    hasAnthropicKey: useAnthropicKeyByDefault,
    hasElevenLabsKey: useElevenLabsKeyByDefault,
    hasEvolinkKey: useEvolinkKeyByDefault,
    hasHostedAudioAccess,
    hasHostedSession,
    hasKieAiKey: useKieAiKeyByDefault,
    hasOpenAiKey: useOpenAiKeyByDefault,
    hostedAIEnabled,
    lemonadeEndpoint,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    setAiApprovalMode,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
    useOpenAiKeyByDefault,
    usePiApiKeyByDefault,
  };
}
