import { useAccountStore } from '../../../stores/accountStore';

export function useFlashBoardComposerAccessState() {
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = accountSession?.authenticated === true;
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseHostedPromptRefiner = Boolean(accountSession?.authenticated && hostedAIEnabled);

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
