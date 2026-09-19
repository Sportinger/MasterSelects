import { hasHostedAiSession, useAccountStore } from '../../../stores/accountStore';

export function useFlashBoardComposerAccessState() {
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = hasHostedAiSession(accountSession);
  const hasHostedAudioAccess = hasHostedSession && hostedAIEnabled;
  const canUseHostedPromptRefiner = hasHostedSession && hostedAIEnabled;

  return {
    accountSession,
    canUseHostedPromptRefiner,
    hasHostedAudioAccess,
    hasHostedSession,
    hostedAIEnabled,
    openAuthDialog,
    openPricingDialog,
  };
}
