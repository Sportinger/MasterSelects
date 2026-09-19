import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardChatControls } from '../../src/components/panels/flashboard/FlashBoardChatControls';

function renderControls(input?: {
  agentMode?: 'standard' | 'direct';
  renderedPopover?: 'chatModelClass' | 'chatProvider' | null;
}) {
  const onChatAgentModeSelect = vi.fn();
  const view = render(
    <FlashBoardChatControls
      activePopover={input?.renderedPopover ?? null}
      chatAgentMode={input?.agentMode ?? 'standard'}
      chatError={null}
      chatPrompt=""
      hasChatMessages={false}
      isChatting={false}
      popoverHostClassName="fb-pill-group"
      popoverRef={createRef<HTMLDivElement>()}
      renderedPopover={input?.renderedPopover ?? null}
      onChatAgentModeSelect={onChatAgentModeSelect}
      onClearChatHistory={vi.fn()}
      onClosePopover={vi.fn()}
      onOpenPopover={vi.fn()}
      onOpenPromptBook={vi.fn()}
    />,
  );
  return { onChatAgentModeSelect, unmount: view.unmount };
}

describe('FlashBoard hosted route controls', () => {
  it('offers only Fast and Codex Direct in the Model menu', () => {
    renderControls({ renderedPopover: 'chatModelClass' });

    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt Book' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Very Fast' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Fast' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Slow' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Codex Direct' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Logic' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'MasterSelectsAI' })).not.toBeInTheDocument();
  });

  it('selects both Fast and Codex Direct', () => {
    const fast = renderControls({ agentMode: 'direct', renderedPopover: 'chatModelClass' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Fast' }));
    expect(fast.onChatAgentModeSelect).toHaveBeenCalledWith('standard');
    fast.unmount();

    const direct = renderControls({ renderedPopover: 'chatModelClass' });
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Codex Direct' }));
    expect(direct.onChatAgentModeSelect).toHaveBeenCalledWith('direct');
  });
});
