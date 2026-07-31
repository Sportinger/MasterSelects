import { describe, expect, it } from 'vitest';
import {
  normalizeStoredAgentActivityEvents,
} from '../../src/services/flashboard/FlashBoardChatActivity';
import {
  serializeFlashBoardChatMessage,
} from '../../src/services/project/flashBoardChatProjectCodec';
import { materializeTimelineVariantSet } from '../../src/services/storyboard/variants';
import { createReleaseActivityEvents } from '../fixtures/storyboard/releaseActivity';
import {
  createReleaseMaterializationIdFactory,
  createStoryboardReleaseJourneyFixture,
} from '../fixtures/storyboard/releaseJourney';

describe('storyboard release bounded-load harness', () => {
  it('materializes twelve independent three-option journeys without base mutation', async () => {
    const journeys = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const fixture = await createStoryboardReleaseJourneyFixture();
      const before = structuredClone(fixture.baseComposition);
      const results = materializeTimelineVariantSet({
        candidateStates: {
          'candidate-option-b': 'ready',
          'candidate-option-c': 'processing',
        },
        compositions: [fixture.baseComposition],
        idFactory: createReleaseMaterializationIdFactory(`release-load-${index}`),
        options: fixture.options,
        rangeSnapshot: fixture.rangeSnapshot,
        variantSet: fixture.variantSet,
      });
      expect(fixture.baseComposition).toEqual(before);
      return results;
    }));

    const roots = journeys.flatMap((results) => (
      results.map((result) => result.graph.rootCompositionId)
    ));
    expect(roots).toHaveLength(36);
    expect(new Set(roots).size).toBe(36);
    expect(journeys.every((results) => (
      results.map((result) => result.option.state).join(',')
      === 'ready,ready,building'
    ))).toBe(true);
  });

  it('bounds a long visible activity journal to the newest 100 safe events', () => {
    const seed = createReleaseActivityEvents()[0];
    const events = Array.from({ length: 150 }, (_, index) => ({
      ...seed,
      id: `release-load-activity-${index}`,
      roundIndex: index,
      createdAt: index,
      rawPrompt: `secret-${index}`,
    }));
    const serialized = serializeFlashBoardChatMessage({
      id: 'release-load-message',
      role: 'assistant',
      text: 'Load run complete.',
      activityEvents: events as never,
    });
    const normalized = normalizeStoredAgentActivityEvents(
      serialized.activityEvents,
    );

    expect(normalized).toHaveLength(100);
    expect(normalized?.[0].id).toBe('release-load-activity-50');
    expect(normalized?.at(-1)?.id).toBe('release-load-activity-149');
    expect(JSON.stringify(normalized)).not.toContain('rawPrompt');
    expect(JSON.stringify(normalized)).not.toContain('secret-');
  });
});
