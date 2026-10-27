// The assistant beta on the phone: the editor's own FlashBoard chat in a tall sheet. It runs the
// same agent, tools, approvals and undo as the desktop chat; nothing here talks to a provider.

import { useEffect } from 'react';

import { DEFAULT_FLASHBOARD_PROVIDER_ID } from '../../../stores/flashboardStore/defaults';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import { hasHostedAiSession, useAccountStore } from '../../../stores/accountStore';
import { FlashBoardComposer } from '../../panels/flashboard/FlashBoardComposer';
import { SeedanceEditorWorkflowProvider } from '../../story/SeedanceEditorWorkflowContext';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import '../../panels/flashboard/FlashBoard.css';
import './PhoneAssistantSheet.css';

const PHONE_ASSISTANT_SERVICES: Array<'cloud'> = ['cloud'];

/** Same chat workspace the /medium entry activates, so desktop and phone share one conversation. */
function activatePrimaryChatWorkspace(): void {
  const flashBoard = useFlashBoardStore.getState();
  const primaryChat = flashBoard.aiWorkspaces.find((workspace) => workspace.kind === 'chat');
  if (primaryChat) flashBoard.activateAIWorkspace(primaryChat.id);
  else flashBoard.createAIWorkspace({ kind: 'chat', title: 'Chat' });
}

export function PhoneAssistantSheet() {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const accountSession = useAccountStore((state) => state.session);
  const hostedAIEnabled = useAccountStore((state) => state.hostedAIEnabled);
  const composer = useFlashBoardStore((state) => state.composer);
  const useHostedDefaults = hasHostedAiSession(accountSession) && hostedAIEnabled;

  useEffect(() => {
    activatePrimaryChatWorkspace();
  }, []);

  return (
    <PhoneSheet title="Assistant (beta)" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-assistant" data-testid="phone-assistant">
        <p className="phone-assistant__hint">
          Ask for an edit in your own words. Every change lands on the timeline as a normal step you can undo.
        </p>
        <div className="phone-assistant__chat">
          {/* The composer's story actions need the workflow the desktop dock provides; the phone
              provides it only while this sheet is open. */}
          <SeedanceEditorWorkflowProvider enabled>
            <FlashBoardComposer
              initialProviderId={composer.providerId ?? DEFAULT_FLASHBOARD_PROVIDER_ID}
              initialService="cloud"
              initialVersion={useHostedDefaults ? 'latest' : composer.version}
              initialMode="chat"
              allowedServices={PHONE_ASSISTANT_SERVICES}
            />
          </SeedanceEditorWorkflowProvider>
        </div>
      </div>
    </PhoneSheet>
  );
}
