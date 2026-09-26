import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FLASHBOARD_CHAT_AGENT_MODE,
  FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY,
  loadStoredFlashBoardChatAgentMode,
  resolveFlashBoardChatAgentMode,
  storeFlashBoardChatAgentMode,
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

  it('preserves an explicit Medium selection', () => {
    expect(resolveFlashBoardChatAgentMode({
      availableAgentModes: ['standard'],
      currentAgentMode: 'direct-medium',
      explicitlySelected: true,
    })).toBe('direct-medium');
  });

  it('shows exactly Fast, Medium and Slow without Logic', () => {
    expect(FLASHBOARD_CHAT_AGENT_OPTIONS).toEqual([
      expect.objectContaining({ id: 'standard', label: 'Fast' }),
      expect.objectContaining({ id: 'direct-medium', label: 'Medium' }),
      expect.objectContaining({ id: 'direct', label: 'Slow' }),
    ]);
  });
});

describe('FlashBoard chat agent-mode persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubStorage(): Map<string, string> {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    return values;
  }

  it('returns null when nothing was stored', () => {
    stubStorage();
    expect(loadStoredFlashBoardChatAgentMode()).toBeNull();
  });

  it('round-trips Fast, Medium and Slow selections', () => {
    stubStorage();
    for (const mode of ['standard', 'direct-medium', 'direct'] as const) {
      storeFlashBoardChatAgentMode(mode);
      expect(loadStoredFlashBoardChatAgentMode()).toBe(mode);
    }
  });

  it('ignores unknown or Logic values', () => {
    const values = stubStorage();
    storeFlashBoardChatAgentMode('logic');
    expect(values.has(FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY)).toBe(false);
    values.set(FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY, 'bogus');
    expect(loadStoredFlashBoardChatAgentMode()).toBeNull();
  });

  it('survives throwing storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(() => storeFlashBoardChatAgentMode('standard')).not.toThrow();
    expect(loadStoredFlashBoardChatAgentMode()).toBeNull();
  });
});
