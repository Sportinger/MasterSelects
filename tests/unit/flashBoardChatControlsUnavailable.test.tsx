import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlashBoardChatControls } from '../../src/components/panels/flashboard/FlashBoardChatControls';
import {
  markFlashBoardChatAgentModeUnavailable,
  resetFlashBoardChatAgentAvailabilityForTests,
} from '../../src/components/panels/flashboard/FlashBoardChatAgentAvailability';

function renderControls(onChatAgentModeSelect = vi.fn()) {
  render(
    <FlashBoardChatControls
      activePopover="chatModelClass"
      chatAgentMode="direct"
      chatError={null}
      chatPrompt=""
      hasChatMessages={false}
      isChatting={false}
      popoverHostClassName=""
      popoverRef={createRef<HTMLDivElement>()}
      renderedPopover="chatModelClass"
      onChatAgentModeSelect={onChatAgentModeSelect}
      onClearChatHistory={vi.fn()}
      onClosePopover={vi.fn()}
      onOpenPromptBook={vi.fn()}
      onOpenPopover={vi.fn()}
    />,
  );
  return onChatAgentModeSelect;
}

const pill = (label: string) => screen.getByRole('menuitemradio', { name: label });

describe('desktop chat model pills', () => {
  afterEach(() => {
    cleanup();
    resetFlashBoardChatAgentAvailabilityForTests();
  });

  it('offers every choice normally while all of them work', () => {
    renderControls();
    expect(pill('Fast').getAttribute('aria-disabled')).toBeNull();
    expect(pill('Fast').className).not.toContain('is-disabled');
  });

  it('greys an unavailable choice with its reason, live, and a click still explains it', () => {
    const onSelect = renderControls();
    act(() => {
      markFlashBoardChatAgentModeUnavailable('standard');
    });
    const fast = pill('Fast');
    expect(fast.getAttribute('aria-disabled')).toBe('true');
    expect(fast.className).toContain('is-disabled');
    expect(fast.getAttribute('title')).toBe('Fast is not available on this server right now. Use Medium or Slow.');
    expect(pill('Medium').getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(fast);
    // The controller answers a greyed choice with its reason instead of selecting it.
    expect(onSelect).toHaveBeenCalledWith('standard');
  });
});
