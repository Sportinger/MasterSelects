import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readStoryboardTelemetryJournal,
  recordStoryboardTelemetry,
  resetStoryboardTelemetryForTests,
  setStoryboardTelemetrySink,
} from '../../src/services/storyboard/telemetry';

afterEach(resetStoryboardTelemetryForTests);

describe('bounded storyboard release telemetry', () => {
  it('keeps only allowlisted aggregate fields and never accepts content payloads', () => {
    const sink = vi.fn();
    setStoryboardTelemetrySink(sink);
    const event = recordStoryboardTelemetry('variant.committed', {
      boundaryPolicy: 'preserve',
      count: 3,
      prompt: 'secret prompt',
      rawHistory: ['private transcript'],
      reason: 'arbitrary provider error with a credential',
      warningCount: Number.POSITIVE_INFINITY,
    }, 100);

    expect(event).toEqual({
      schemaVersion: 1,
      name: 'variant.committed',
      occurredAt: 100,
      attributes: {
        boundaryPolicy: 'preserve',
        count: 3,
      },
    });
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('transcript');
    expect(JSON.stringify(event)).not.toContain('credential');
    expect(sink).toHaveBeenCalledWith(event);
  });

  it('caps the in-memory journal and removes expired events', () => {
    for (let index = 0; index < 240; index += 1) {
      recordStoryboardTelemetry('variant.materialized', {
        optionCount: 3,
        status: 'full',
      }, index);
    }
    const capped = readStoryboardTelemetryJournal(240);
    expect(capped).toHaveLength(200);
    expect(capped[0]!.occurredAt).toBe(40);

    expect(readStoryboardTelemetryJournal(60 * 60 * 1_000 + 241)).toEqual([]);
  });
});
