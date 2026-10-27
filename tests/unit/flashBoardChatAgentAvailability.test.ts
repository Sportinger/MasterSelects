import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  availableFlashBoardChatAgentMode,
  getFlashBoardChatAgentUnavailability,
  isDirectModelProviderMissingError,
  markFlashBoardChatAgentModeUnavailable,
  recordFlashBoardChatAgentModeWorked,
  resetFlashBoardChatAgentAvailabilityForTests,
  subscribeFlashBoardChatAgentUnavailability,
} from '../../src/components/panels/flashboard/FlashBoardChatAgentAvailability';

const PRODUCTION_ERROR = 'Codex Direct failed: failed to load configuration: Model provider `deepseek` not found';

describe('Direct model-provider failure shape', () => {
  it('recognises the production app-server error', () => {
    expect(isDirectModelProviderMissingError(PRODUCTION_ERROR)).toBe(true);
  });

  it('recognises other wordings of the same cause', () => {
    for (const message of [
      'failed to load configuration: model provider "deepseek" not found',
      "Model provider 'deepseek' is not configured",
      'unknown model provider: deepseek',
      'Codex Direct failed: model_provider deepseek does not exist',
      'No model provider named deepseek',
      'Codex Direct failed: failed to load configuration:\n  Model provider `openrouter` not found',
    ]) {
      expect(isDirectModelProviderMissingError(message), message).toBe(true);
    }
  });

  it('leaves unrelated failures alone', () => {
    for (const message of [
      '',
      null,
      undefined,
      'Codex Direct failed: unknown app-server error',
      'Codex Direct ended with status failed.',
      'Model deepseek-flash not found',
      'The assistant service cannot be reached right now.',
      'Chat stopped.',
      'Rate limit reached for model provider requests. Try again later.',
    ]) {
      expect(isDirectModelProviderMissingError(message), String(message)).toBe(false);
    }
  });
});

describe('session availability of Fast, Medium and Slow', () => {
  afterEach(() => {
    resetFlashBoardChatAgentAvailabilityForTests();
  });

  it('greys Fast with the owner-facing reason and notifies every surface', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlashBoardChatAgentUnavailability(listener);
    const reason = markFlashBoardChatAgentModeUnavailable('standard');
    unsubscribe();
    expect(reason).toBe('Fast is not available on this server right now. Use Medium or Slow.');
    expect(getFlashBoardChatAgentUnavailability()).toEqual({ standard: reason });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one stable snapshot when the same choice fails again', () => {
    markFlashBoardChatAgentModeUnavailable('standard');
    const snapshot = getFlashBoardChatAgentUnavailability();
    const listener = vi.fn();
    const unsubscribe = subscribeFlashBoardChatAgentUnavailability(listener);
    markFlashBoardChatAgentModeUnavailable('standard');
    unsubscribe();
    expect(getFlashBoardChatAgentUnavailability()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it('falls back to Slow when nothing else has worked yet', () => {
    expect(availableFlashBoardChatAgentMode('standard')).toBe('standard');
    markFlashBoardChatAgentModeUnavailable('standard');
    expect(availableFlashBoardChatAgentMode('standard')).toBe('direct');
    expect(availableFlashBoardChatAgentMode('direct-medium')).toBe('direct-medium');
  });

  it('falls back to the last working choice', () => {
    recordFlashBoardChatAgentModeWorked('direct-medium');
    markFlashBoardChatAgentModeUnavailable('standard');
    expect(availableFlashBoardChatAgentMode('standard')).toBe('direct-medium');
  });

  it('never falls back to a choice that has failed itself', () => {
    recordFlashBoardChatAgentModeWorked('standard');
    markFlashBoardChatAgentModeUnavailable('standard');
    expect(availableFlashBoardChatAgentMode('standard')).toBe('direct');
  });

  it('rewrites earlier advice so it never recommends another greyed choice', () => {
    markFlashBoardChatAgentModeUnavailable('standard');
    markFlashBoardChatAgentModeUnavailable('direct-medium');
    expect(getFlashBoardChatAgentUnavailability()).toEqual({
      standard: 'Fast is not available on this server right now. Use Slow.',
      'direct-medium': 'Medium is not available on this server right now. Use Slow.',
    });
    expect(availableFlashBoardChatAgentMode('direct-medium')).toBe('direct');
  });
});
