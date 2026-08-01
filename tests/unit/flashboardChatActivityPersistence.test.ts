import { describe, expect, it } from 'vitest';
import {
  normalizeFlashBoardChatMessage,
  serializeFlashBoardChatMessage,
} from '../../src/services/project/flashBoardChatProjectCodec';

describe('FlashBoard narrated activity persistence', () => {
  it('round-trips valid activity in order while stripping arbitrary payloads', () => {
    const serialized = serializeFlashBoardChatMessage({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Done',
      activityEvents: [{
        id: 'narration-1',
        runId: 'run-1',
        kind: 'narration',
        source: 'model',
        phase: 'inspecting',
        roundIndex: 0,
        text: 'I am checking the timeline.',
        createdAt: 1,
        rawProviderPayload: { secret: 'must-not-persist' },
      } as never, {
        id: 'operation-1',
        runId: 'run-1',
        kind: 'operation',
        source: 'runtime',
        phase: 'failed',
        safeLabel: 'Trim clip',
        operationId: 'provider-call-1',
        toolName: 'trimClip',
        createdAt: 2,
        arguments: '{"clipId":"sensitive"}',
      } as never],
    });

    expect(serialized.activityEvents).toEqual([
      expect.objectContaining({ id: 'narration-1', text: 'I am checking the timeline.' }),
      expect.objectContaining({
        id: 'operation-1',
        operationId: 'provider-call-1',
        safeLabel: 'Trim clip',
        phase: 'failed',
      }),
    ]);
    expect(JSON.stringify(serialized.activityEvents)).not.toContain('secret');
    expect(JSON.stringify(serialized.activityEvents)).not.toContain('arguments');

    const normalized = normalizeFlashBoardChatMessage(serialized);
    expect(normalized?.activityEvents?.map((event) => event.id))
      .toEqual(['narration-1', 'operation-1']);
  });

  it('drops malformed events and never restores extra payload fields', () => {
    const normalized = normalizeFlashBoardChatMessage({
      id: 'assistant-1',
      role: 'assistant',
      text: 'Done',
      activityEvents: [{
        id: 'invalid',
        runId: 'run-1',
        kind: 'narration',
        source: 'model',
        phase: 'hidden-reasoning',
        roundIndex: 0,
        text: 'Do not restore this.',
        createdAt: 1,
      }, {
        id: 'progress-1',
        runId: 'run-1',
        kind: 'progress',
        source: 'runtime',
        label: 'Reading timeline',
        createdAt: 2,
        payload: 'private',
      }],
    });

    expect(normalized?.activityEvents).toEqual([{
      id: 'progress-1',
      runId: 'run-1',
      kind: 'progress',
      source: 'runtime',
      label: 'Reading timeline',
      createdAt: 2,
    }]);
    expect(JSON.stringify(normalized?.activityEvents)).not.toContain('private');
  });
});
