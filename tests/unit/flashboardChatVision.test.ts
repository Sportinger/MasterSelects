import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeFlashBoardToolCalls,
  getFlashBoardToolResultImage,
  prepareFlashBoardToolCallsForHistory,
} from '../../src/services/flashboard/FlashBoardChatTools';
import { handleGetFramesAtTimes } from '../../src/services/aiTools/handlers/preview';

const mocks = vi.hoisted(() => ({ executeAIToolCalls: vi.fn() }));

vi.mock('../../src/services/aiTools', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/services/aiTools')>(),
  executeAIToolCalls: mocks.executeAIToolCalls,
}));

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('FlashBoard visual tool boundaries', () => {
  beforeEach(() => mocks.executeAIToolCalls.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it('rejects malformed frame samples before touching the playhead', async () => {
    const setPlayheadPosition = vi.fn();

    await expect(handleGetFramesAtTimes(
      { times: ['bad', Number.NaN] },
      { setPlayheadPosition } as never,
    )).resolves.toEqual({ success: false, error: 'Provide at least one finite frame time.' });
    expect(setPlayheadPosition).not.toHaveBeenCalled();
  });

  it('finds and redacts frame data nested inside operation results', () => {
    const toolCalls = [{
      modelContent: '{"success":true}',
      result: {
        success: true,
        data: { results: [{ tool: 'captureFrame', data: { dataUrl: DATA_URL } }] },
      },
      toolCall: { id: 'batch-1', name: 'executeBatch', arguments: '{}' },
    }];

    expect(getFlashBoardToolResultImage(toolCalls[0])?.dataUrl).toBe(DATA_URL);
    const history = prepareFlashBoardToolCallsForHistory(toolCalls);
    expect(JSON.stringify(history)).not.toContain(DATA_URL);
    expect(JSON.stringify(history)).toContain('[image omitted from chat history]');
  });

  it('blocks mutating tools during read-only Normal Path turns', async () => {
    const results = await executeFlashBoardToolCalls([{
      id: 'delete-1',
      name: 'deleteClip',
      arguments: '{"clipId":"clip-1"}',
    }], 8_000, { toolExecutionMode: 'read-only' });

    expect(results[0]?.result).toMatchObject({
      success: false,
      error: expect.stringMatching(/read-only/i),
    });
    expect(mocks.executeAIToolCalls).not.toHaveBeenCalled();
  });
});
