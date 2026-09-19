import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FLASHBOARD_CHAT_AGENT_MODE,
  resolveFlashBoardChatAgentMode,
} from '../../src/components/panels/flashboard/FlashBoardChatAgentMode';
import { FLASHBOARD_CHAT_AGENT_OPTIONS } from '../../src/components/panels/flashboard/flashBoardChatAgentOptions';

describe('FlashBoard chat agent-mode default', () => {
  it('starts every new controller in Codex Direct mode', () => {
    expect(DEFAULT_FLASHBOARD_CHAT_AGENT_MODE).toBe('direct');
  });

  it('keeps Codex Direct when the server advertises Logic', () => {
    expect(resolveFlashBoardChatAgentMode({
      availableAgentModes: ['standard', 'logic'],
      currentAgentMode: 'standard',
      explicitlySelected: false,
    })).toBe('direct');
  });

  it('preserves an explicit Standard selection', () => {
    expect(resolveFlashBoardChatAgentMode({
      availableAgentModes: ['standard', 'logic'],
      currentAgentMode: 'standard',
      explicitlySelected: true,
    })).toBe('standard');
  });

  it('moves an old Logic selection to Codex Direct', () => {
    expect(resolveFlashBoardChatAgentMode({
      availableAgentModes: ['standard'],
      currentAgentMode: 'logic',
      explicitlySelected: true,
    })).toBe('direct');
  });

  it('shows exactly Fast and Codex Direct without Logic', () => {
    expect(FLASHBOARD_CHAT_AGENT_OPTIONS).toEqual([
      expect.objectContaining({ id: 'standard', label: 'Fast' }),
      expect.objectContaining({ id: 'direct', label: 'Codex Direct' }),
    ]);
  });
});
