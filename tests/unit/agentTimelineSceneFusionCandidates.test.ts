import { describe, expect, it } from 'vitest';
import { fuseAgentTimelineScenes } from '../../src/services/agentTimeline/fusion/scenes/fuseAgentTimelineScenes';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
} from '../../src/types/agentTimeline/manifest';

function shot(id: string, start: number, end: number, setupId?: string): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: `shot-${id}`,
    type: 'shot',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'shots', analyzerVersion: '1' }],
    data: { shotId: id, setupId },
  };
}

function cut(time: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: `cut-${time}`,
    type: 'cut',
    time: { temporalKind: 'point', timeDomain: 'source', time },
    confidence: 0.95,
    provenance: [{ kind: 'analyzer', analyzerId: 'cuts', analyzerVersion: '1' }],
    data: { score: 0.96, transition: 'hard' },
  };
}

function speech(id: string, start: number, end: number, text: string, speakerId = 'speaker-a'): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'speech',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'transcript', analyzerVersion: '1' }],
    data: { speakerId, text },
  };
}

function quality(id: string, start: number, end: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'quality-issue',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'quality', analyzerVersion: '1' }],
    data: {
      issue: 'focus',
      severity: 'critical',
      measurement: 0.1,
      threshold: 0.3,
      unit: 'normalized',
    },
  };
}

const exactText = 'one two three four five six seven eight nine ten eleven twelve';
const nearText = 'one two three four five six seven eight nine ten eleven thirteen';

function repeatedTakeEvents(secondText = exactText, secondSpeaker = 'speaker-a', unknownSetup = false): AgentTimelineEvent[] {
  return [
    shot('1a', 0, 4, unknownSetup ? undefined : 'setup-a'),
    shot('1b', 4, 8, 'setup-b'),
    cut(8),
    shot('2a', 8, 12, unknownSetup ? undefined : 'setup-a'),
    shot('2b', 12, 16, 'setup-b'),
    speech('speech-1', 0.5, 7.5, exactText),
    speech('speech-2', 8.5, 15.5, secondText, secondSpeaker),
    quality('quality-1', 1, 2),
  ];
}

describe('conservative scene candidate fusion', () => {
  it('emits review-only redundancy candidates without automatic duplicate-group events', () => {
    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: repeatedTakeEvents(),
    });

    expect(result.sceneEvents).toHaveLength(2);
    expect(result.sceneEvents.every((event) => event.type === 'scene-block')).toBe(true);
    expect(result.candidateGroups).toHaveLength(1);
    expect(result.candidateGroups[0]).toMatchObject({
      kind: 'redundancy-candidate',
      disposition: 'review-required',
      sourceId: 'source-a',
      confidence: 1,
      evidence: [{
        sameSetupSequence: true,
        exactNormalizedTranscript: true,
        sameSpeakerSequence: true,
        sourceDistance: 0,
      }],
    });
    expect(result.candidateGroups[0].memberReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        qualityIssueCount: 1,
        criticalQualityIssueCount: 1,
        qualityEventIds: ['quality-1'],
      }),
    ]));
  });

  it('labels high-similarity non-identical transcript matches as take candidates', () => {
    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: repeatedTakeEvents(nearText),
      policy: { takeMinimumTranscriptSimilarity: 0.7 },
    });

    expect(result.candidateGroups).toHaveLength(1);
    expect(result.candidateGroups[0].kind).toBe('take-candidate');
    expect(result.candidateGroups[0].evidence[0].exactNormalizedTranscript).toBe(false);
    expect(result.candidateGroups[0].confidence).toBeLessThan(1);
  });

  it('prefers precision and leaves speaker/setup/lexical mismatches ungrouped', () => {
    const speakerMismatch = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: repeatedTakeEvents(exactText, 'speaker-b'),
    });
    const setupUnknown = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: repeatedTakeEvents(exactText, 'speaker-a', true),
    });
    const lexicalMismatch = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: repeatedTakeEvents('violet cloud river stone window lantern quiet meadow'),
    });

    expect(speakerMismatch.candidateGroups).toEqual([]);
    expect(setupUnknown.candidateGroups).toEqual([]);
    expect(lexicalMismatch.candidateGroups).toEqual([]);
  });

  it('produces stable source-local IDs and results independent of input order', () => {
    const events = repeatedTakeEvents();
    const first = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events,
    });
    const second = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: events.toReversed(),
    });
    const otherSource = fuseAgentTimelineScenes({
      sourceId: 'source-b',
      range: { start: 0, end: 16 },
      events,
    });

    expect(second).toEqual(first);
    expect(first.sceneEvents[0].id).not.toBe(otherSource.sceneEvents[0].id);
    expect(first.candidateGroups[0].id).not.toBe(otherSource.candidateGroups[0].id);
  });
});
