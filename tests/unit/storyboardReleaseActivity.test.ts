import { describe, expect, it } from 'vitest';
import {
  normalizeStoredAgentActivityEvents,
} from '../../src/services/flashboard/FlashBoardChatActivity';
import {
  normalizeFlashBoardChatMessage,
  serializeFlashBoardChatMessage,
} from '../../src/services/project/flashBoardChatProjectCodec';
import { createReleaseActivityEvents } from '../fixtures/storyboard/releaseActivity';

describe('storyboard release activity authority and persistence', () => {
  it('keeps model narration and authoritative runtime outcomes distinct and ordered', () => {
    const events = createReleaseActivityEvents();
    const normalized = normalizeStoredAgentActivityEvents([
      ...events,
      {
        id: 'spoofed-operation',
        runId: 'release-run',
        kind: 'operation',
        source: 'model',
        phase: 'completed',
        safeLabel: 'Pretend success',
        createdAt: 6,
      },
    ]);

    expect(normalized?.map((event) => event.id))
      .toEqual(events.map((event) => event.id));
    expect(normalized?.filter((event) => event.kind === 'narration').every(
      (event) => event.source === 'model',
    )).toBe(true);
    expect(normalized?.filter((event) => event.kind === 'operation').every(
      (event) => event.source === 'runtime',
    )).toBe(true);
    expect(normalized?.at(-1)).toMatchObject({
      kind: 'operation',
      source: 'runtime',
      phase: 'failed',
      safeLabel: 'Prepare option C',
    });
  });

  it('survives chat reload without raw prompts, arguments, or hidden reasoning', () => {
    const serialized = serializeFlashBoardChatMessage({
      id: 'release-assistant-message',
      role: 'assistant',
      text: 'Three options prepared; option C failed.',
      activityEvents: createReleaseActivityEvents().map((event) => ({
        ...event,
        rawPrompt: 'secret release prompt',
        arguments: '{"sensitive":true}',
        hiddenReasoning: 'must not persist',
      } as never)),
    });
    const restored = normalizeFlashBoardChatMessage(
      JSON.parse(JSON.stringify(serialized)),
    );

    expect(restored?.activityEvents?.map((event) => event.id))
      .toEqual(createReleaseActivityEvents().map((event) => event.id));
    expect(restored?.activityEvents?.at(-1)).toMatchObject({
      kind: 'operation',
      phase: 'failed',
    });
    const persisted = JSON.stringify(restored?.activityEvents);
    expect(persisted).not.toContain('secret release prompt');
    expect(persisted).not.toContain('sensitive');
    expect(persisted).not.toContain('hiddenReasoning');
  });
});
