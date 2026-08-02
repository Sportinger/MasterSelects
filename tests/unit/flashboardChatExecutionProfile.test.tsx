import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardChatControls } from '../../src/components/panels/flashboard/FlashBoardChatControls';

function renderControls(input?: {
  availableModelClasses?: readonly ('very-fast' | 'fast' | 'slow')[];
  modelClass?: 'very-fast' | 'fast' | 'slow';
  renderedPopover?: 'chatModelClass' | 'chatProvider' | null;
}) {
  const onChatModelClassSelect = vi.fn();
  const view = render(
    <FlashBoardChatControls
      activePopover={input?.renderedPopover ?? null}
      availableChatModelClasses={input?.availableModelClasses ?? ['very-fast', 'fast', 'slow']}
      chatError={null}
      chatModelClass={input?.modelClass ?? 'fast'}
      chatModelClassAvailabilityStatus="ready"
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
      showChatModelClass
      onChatModelClassSelect={onChatModelClassSelect}
      onChatProviderSelect={vi.fn()}
      onClearChatHistory={vi.fn()}
      onClosePopover={vi.fn()}
      onOpenPopover={vi.fn()}
      onOpenPromptBook={vi.fn()}
    />,
  );
  return { onChatModelClassSelect, unmount: view.unmount };
}

describe('FlashBoard hosted Fast V2 model-speed control', () => {
  it('keeps Fast as the visible default and leaves the model control intact', () => {
    renderControls();

    expect(screen.getByRole('button', { name: 'Fast' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt Book' })).toBeInTheDocument();
  });

  it('offers all three fixed Fast V2 model classes and respects availability', () => {
    const available = renderControls({ renderedPopover: 'chatModelClass' });
    const veryFast = screen.getByRole('menuitemradio', { name: 'Very Fast' });
    const fast = screen.getByRole('menuitemradio', { name: 'Fast' });
    const slow = screen.getByRole('menuitemradio', { name: 'Slow' });
    expect(veryFast).toBeEnabled();
    expect(fast).toBeEnabled();
    expect(slow).toBeEnabled();
    fireEvent.click(slow);
    expect(available.onChatModelClassSelect).toHaveBeenCalledWith('slow');

    available.unmount();
    const unavailable = renderControls({
      availableModelClasses: [],
      renderedPopover: 'chatModelClass',
    });
    const unavailableVeryFast = screen.getByRole('menuitemradio', { name: 'Very Fast' });
    expect(unavailableVeryFast).toBeDisabled();
    fireEvent.click(unavailableVeryFast);
    expect(unavailable.onChatModelClassSelect).not.toHaveBeenCalled();
  });
});
