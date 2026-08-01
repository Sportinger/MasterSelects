import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardChatControls } from '../../src/components/panels/flashboard/FlashBoardChatControls';

function renderControls(input?: {
  availableExecutionProfiles?: readonly ('fast' | 'verified')[];
  executionProfile?: 'fast' | 'verified';
  renderedPopover?: 'chatExecutionProfile' | 'chatProvider' | null;
}) {
  const onChatExecutionProfileSelect = vi.fn();
  const view = render(
    <FlashBoardChatControls
      activePopover={input?.renderedPopover ?? null}
      availableChatExecutionProfiles={input?.availableExecutionProfiles ?? ['fast']}
      chatError={null}
      chatExecutionProfile={input?.executionProfile ?? 'fast'}
      chatExecutionProfileAvailabilityStatus="ready"
      chatPrompt=""
      chatProvider="kie"
      chatProviderLabel="Kie"
      chatProviderOptions={[
        { id: 'kie', label: 'AI' },
        { id: 'kernel', label: 'MasterSelectsAI' },
      ]}
      hasChatMessages={false}
      isChatting={false}
      popoverHostClassName="fb-pill-group"
      popoverRef={createRef<HTMLDivElement>()}
      renderedPopover={input?.renderedPopover ?? null}
      showChatExecutionProfile
      onChatExecutionProfileSelect={onChatExecutionProfileSelect}
      onChatProviderSelect={vi.fn()}
      onClearChatHistory={vi.fn()}
      onClosePopover={vi.fn()}
      onOpenPopover={vi.fn()}
      onOpenPromptBook={vi.fn()}
    />,
  );
  return { onChatExecutionProfileSelect, unmount: view.unmount };
}

describe('FlashBoard hosted execution profile control', () => {
  it('keeps Fast as the visible default and leaves the model control intact', () => {
    renderControls();

    expect(screen.getByRole('button', { name: 'Fast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt Book' })).toBeInTheDocument();
  });

  it('allows Verified only when server-selected availability includes the local pilot', () => {
    const unavailable = renderControls({ renderedPopover: 'chatExecutionProfile' });
    const unavailableVerified = screen.getByRole('menuitemradio', {
      name: 'Verified · local pilot',
    });
    expect(unavailableVerified).toBeDisabled();
    fireEvent.click(unavailableVerified);
    expect(unavailable.onChatExecutionProfileSelect).not.toHaveBeenCalled();

    unavailable.unmount();
    const available = renderControls({
      availableExecutionProfiles: ['fast', 'verified'],
      renderedPopover: 'chatExecutionProfile',
    });
    const availableVerified = screen.getByRole('menuitemradio', {
      name: 'Verified · local pilot',
    });
    expect(availableVerified).toBeEnabled();
    fireEvent.click(availableVerified);
    expect(available.onChatExecutionProfileSelect).toHaveBeenCalledWith('verified');
  });
});
