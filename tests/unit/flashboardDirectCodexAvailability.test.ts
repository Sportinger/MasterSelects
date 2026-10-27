import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE,
  DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE,
  directCodexUnavailableMessage,
  isDirectCodexUnavailableMessage,
} from '../../src/services/flashboard/FlashBoardDirectCodexAvailability';
import { sendDirectCodexChat } from '../../src/services/flashboard/FlashBoardDirectCodexTransport';
import {
  clearDirectCodexReloadSnapshot,
  readDirectCodexReloadSnapshot,
  saveDirectCodexReloadSnapshot,
} from '../../src/services/flashboard/FlashBoardDirectCodexReloadResume';

/** A socket whose upgrade the relay refused: no 'open', only the events `events` names. */
function stubRefusedSocket(events: ReadonlyArray<'error' | 'close'>): void {
  class RefusedSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    constructor(readonly url: string) {
      super();
      setTimeout(() => {
        for (const type of events) {
          if (type === 'close') this.readyState = 3;
          this.dispatchEvent(new Event(type));
        }
      }, 0);
    }
    send(): void { throw new Error('not open'); }
    close(): void { this.readyState = 3; }
  }
  vi.stubGlobal('WebSocket', RefusedSocket);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    session: { authenticated: true },
  }), { status: 200 })));
}

const request = { agentPath: 'direct-codex' as const, prompt: 'Cut the first clip.', provider: 'kie' as const, model: 'm', temperature: 0.2 };

describe('Direct socket unavailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('gives production users a sentence without the developer command', () => {
    expect(directCodexUnavailableMessage(false)).toBe(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE);
    expect(directCodexUnavailableMessage(false)).not.toMatch(/npm|dev:full/);
    expect(directCodexUnavailableMessage(true)).toBe(DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE);
    expect(isDirectCodexUnavailableMessage(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE)).toBe(true);
    expect(isDirectCodexUnavailableMessage(DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE)).toBe(true);
    expect(isDirectCodexUnavailableMessage('Codex Direct failed.')).toBe(false);
  });

  it('a refused upgrade (error, then close) fails with the production message in a production build', async () => {
    vi.stubEnv('DEV', false);
    stubRefusedSocket(['error', 'close']);
    await expect(sendDirectCodexChat(request)).rejects.toThrow(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE);
  });

  it('keeps the local-stack hint in development builds', async () => {
    vi.stubEnv('DEV', true);
    stubRefusedSocket(['error', 'close']);
    await expect(sendDirectCodexChat(request)).rejects.toThrow(DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE);
  });

  it('a bare close before open fails instead of leaving the request waiting forever', async () => {
    vi.stubEnv('DEV', false);
    stubRefusedSocket(['close']);
    await expect(sendDirectCodexChat(request)).rejects.toThrow(DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE);
  }, 5_000);
});

describe('Direct reload snapshot Undo group', () => {
  it('keeps the request group id so a resume joins the original Undo step', () => {
    saveDirectCodexReloadSnapshot({
      assistantMessageId: 'assistant-group-1', conversationRef: 'default', prompt: 'Trim it.',
      requestGroupId: 'chat-run-1234', threadId: 'thread-1', turnId: 'turn-1',
    });
    expect(readDirectCodexReloadSnapshot('assistant-group-1')?.requestGroupId).toBe('chat-run-1234');
    clearDirectCodexReloadSnapshot('assistant-group-1');
  });

  it('rejects a snapshot whose group id is not an identifier', () => {
    saveDirectCodexReloadSnapshot({
      assistantMessageId: 'assistant-group-2', conversationRef: 'default', prompt: 'Trim it.',
      requestGroupId: 'not valid!', threadId: 'thread-1', turnId: 'turn-1',
    });
    expect(readDirectCodexReloadSnapshot('assistant-group-2')).toBeNull();
  });
});
