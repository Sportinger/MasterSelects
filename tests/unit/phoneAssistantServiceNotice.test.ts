import { describe, expect, it } from 'vitest';

import { phoneAssistantServiceNotice } from '../../src/components/mobileSkin/assistant/phoneAssistantModel';
import {
  DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE,
  DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE,
} from '../../src/services/flashboard/FlashBoardDirectCodexAvailability';
import type { FlashBoardChatMessage } from '../../src/stores/flashboardStore';

const user = (text: string, id = 'u1'): FlashBoardChatMessage => ({ id, role: 'user', text });
const failed = (text: string, id = 'a1'): FlashBoardChatMessage => ({ id, role: 'assistant', text, isError: true });

describe('phone assistant service state', () => {
  it('shows the unreachable state with the failed request for Try again', () => {
    expect(phoneAssistantServiceNotice([user('Cut the intro.'), failed(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE)])).toEqual({
      kind: 'unreachable', message: DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE, retryPrompt: 'Cut the intro.',
    });
  });

  it('recognises the development hint too', () => {
    expect(phoneAssistantServiceNotice([user('x'), failed(DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE)])?.kind).toBe('unreachable');
  });

  it('stays away for other failures, pending requests and once a newer answer worked', () => {
    expect(phoneAssistantServiceNotice([user('x'), failed('A tool failed.')])).toBeNull();
    expect(phoneAssistantServiceNotice([
      user('x'), failed(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE), user('y', 'u2'),
      { id: 'a2', role: 'assistant', text: 'Thinking…', isPending: true },
    ])).toBeNull();
    expect(phoneAssistantServiceNotice([
      user('x'), failed(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE), user('y', 'u2'), { id: 'a2', role: 'assistant', text: 'Done.' },
    ])).toBeNull();
    expect(phoneAssistantServiceNotice([])).toBeNull();
  });
});
