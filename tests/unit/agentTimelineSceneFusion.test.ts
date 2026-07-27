import { describe, expect, it } from 'vitest';
import { fuseAgentTimelineScenes } from '../../src/services/agentTimeline/fusion/scenes/fuseAgentTimelineScenes';
import {
  AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
  type AgentTimelineEvent,
} from '../../src/types/agentTimeline/manifest';

function shot(id: string, start: number, end: number, setupId?: string): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id: `shot-event-${id}`,
    type: 'shot',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'shot-analyzer', analyzerVersion: '1' }],
    data: { shotId: id, setupId },
  };
}

function cut(id: string, time: number, score = 0.95, confidence = 0.9): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'cut',
    time: { temporalKind: 'point', timeDomain: 'source', time },
    confidence,
    provenance: [{ kind: 'analyzer', analyzerId: 'cut-analyzer', analyzerVersion: '1' }],
    data: { score, transition: 'hard' },
  };
}

function speech(
  id: string,
  start: number,
  end: number,
  speakerId: string,
  text: string,
): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'speech',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'transcriber', analyzerVersion: '1' }],
    data: { speakerId, text },
  };
}

function silence(id: string, start: number, end: number): AgentTimelineEvent {
  return {
    schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
    id,
    type: 'audio-activity',
    time: { temporalKind: 'interval', timeDomain: 'source', start, end },
    confidence: 0.9,
    provenance: [{ kind: 'analyzer', analyzerId: 'silence', analyzerVersion: '1' }],
    data: { activity: 'silence' },
  };
}

describe('rule-based scene block fusion', () => {
  it('splits on strong setup reset and cut evidence with explicit start reasons', () => {
    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 16 },
      events: [
        shot('a1', 0, 4, 'setup-a'),
        shot('a2', 4, 8, 'setup-a'),
        shot('b1', 8, 12, 'setup-b'),
        shot('b2', 12, 16, 'setup-b'),
        cut('strong-cut', 12),
        cut('excluded-end-cut', 16),
      ],
    });

    expect(result.sceneEvents.map((event) => ({
      range: event.time,
      reasons: event.data.boundaryReasons.map((reason) => reason.reason),
      shots: event.data.shotIds,
    }))).toEqual([
      {
        range: { temporalKind: 'interval', timeDomain: 'source', start: 0, end: 8 },
        reasons: ['range-start'],
        shots: ['a1', 'a2'],
      },
      {
        range: { temporalKind: 'interval', timeDomain: 'source', start: 8, end: 12 },
        reasons: ['setup-reset'],
        shots: ['b1'],
      },
      {
        range: { temporalKind: 'interval', timeDomain: 'source', start: 12, end: 16 },
        reasons: ['strong-cut'],
        shots: ['b2'],
      },
    ]);
    expect(result.sceneEvents.every((event) =>
      event.provenance.some((item) =>
        item.kind === 'analyzer' && item.analyzerId === 'rule-based-scene-fusion'
      )
    )).toBe(true);
    expect(result.coverage).toEqual({
      status: 'complete',
      covered: [{ start: 0, end: 16 }],
      missing: [],
    });
  });

  it('combines lexical topic, long silence, and speaker change evidence', () => {
    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 10 },
      events: [
        shot('left', 0, 5, 'setup-a'),
        shot('right', 5, 10, 'setup-b'),
        speech('before', 0.5, 4, 'speaker-a', 'orchard apples trees harvest baskets farmers today'),
        speech('after', 6, 9.5, 'speaker-b', 'rocket engines orbit launch capsule astronauts tomorrow'),
        silence('pause', 4, 6),
      ],
    });

    expect(result.sceneEvents).toHaveLength(2);
    expect(result.sceneEvents[1].data.boundaryReasons.map((reason) => reason.reason)).toEqual([
      'topic-shift',
      'long-silence',
      'speaker-change',
    ]);
    expect(result.sceneEvents[1].data.boundaryConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('does not split on a single setup change or weak cut and reports unavailable evidence', () => {
    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 10 },
      events: [
        shot('first', 0, 5, 'setup-a'),
        shot('second', 5, 10, 'setup-b'),
        cut('weak', 5, 0.4, 0.5),
      ],
    });

    expect(result.sceneEvents).toHaveLength(1);
    expect(result.sceneEvents[0].data.shotIds).toEqual(['first', 'second']);
    expect(result.unknowns.map((item) => item.code)).toEqual([
      'silence-evidence-unavailable',
      'speaker-evidence-unavailable',
      'transcript-evidence-unavailable',
    ]);
  });

  it('uses half-open source ranges, preserves partial coverage, and never mutates events', () => {
    const events = [
      shot('inside-a', 1, 4, 'setup-a'),
      shot('inside-b', 6, 9, 'setup-a'),
      shot('at-end', 10, 12, 'setup-b'),
    ];
    const snapshot = structuredClone(events);

    const result = fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 10 },
      events,
    });

    expect(result.sceneEvents.map((event) => event.data.shotIds)).toEqual([
      ['inside-a'],
      ['inside-b'],
    ]);
    expect(result.coverage).toEqual({
      status: 'partial',
      covered: [{ start: 1, end: 4 }, { start: 6, end: 9 }],
      missing: [{ start: 0, end: 1 }, { start: 4, end: 6 }, { start: 9, end: 10 }],
    });
    expect(events).toEqual(snapshot);
  });

  it('rejects invalid policy thresholds before producing non-finite confidence', () => {
    expect(() => fuseAgentTimelineScenes({
      sourceId: 'source-a',
      range: { start: 0, end: 10 },
      events: [shot('shot', 0, 10, 'setup-a')],
      policy: { takeMaximumSourceDistance: 0 },
    })).toThrow(RangeError);
  });
});
