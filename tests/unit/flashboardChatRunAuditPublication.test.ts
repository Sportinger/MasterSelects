import { afterEach, describe, expect, it, vi } from 'vitest';

const publication = vi.hoisted(() => ({
  appendJournal: vi.fn<(key: string, record: unknown) => Promise<void>>(),
}));

vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({
  captureRepositoryDomainPublication: () => publication,
}));

import { Logger } from '../../src/services/logger';
import {
  beginFlashBoardChatRun,
  completeFlashBoardChatRun,
} from '../../src/services/flashboard/FlashBoardChatRunAudit';

function startRun(): string {
  return beginFlashBoardChatRun({
    hostedAvailable: false,
    model: 'test-model',
    prompt: 'Inspect the timeline.',
    provider: 'kie',
    temperature: 0.5,
  }).runId;
}

describe('FlashBoard chat run audit repository publication', () => {
  afterEach(() => {
    publication.appendJournal.mockReset();
    vi.restoreAllMocks();
  });

  it('keeps publishing later audits after one append failed and logs the failure once', async () => {
    const stale = new DOMException('The state had changed since it was read from disk.', 'InvalidStateError');
    publication.appendJournal
      .mockRejectedValueOnce(stale)
      .mockRejectedValueOnce(stale)
      .mockResolvedValue(undefined);
    Logger.clear();

    const first = startRun();
    completeFlashBoardChatRun(first, { executedToolCalls: [], response: 'one' });
    const second = startRun();

    await vi.waitFor(() => expect(publication.appendJournal).toHaveBeenCalledTimes(3));
    expect(publication.appendJournal.mock.calls.map(([key]) => key)).toEqual([
      `chat-run:${first}`,
      `chat-run:${first}`,
      `chat-run:${second}`,
    ]);
    const failures = Logger.search('Repository chat audit publication failed')
      .filter((entry) => entry.level === 'ERROR');
    expect(failures).toHaveLength(1);
    completeFlashBoardChatRun(second, { executedToolCalls: [], response: 'two' });
  });
});
