import { describe, expect, it } from 'vitest';
import { estimateAgentTimelineAnalysis } from '../../src/services/agentTimeline/profiles/analysisEstimate';
import { getAgentTimelineProfileSettings } from '../../src/services/agentTimeline/profiles/analysisProfiles';

describe('Agent Timeline analysis estimates', () => {
  it('estimates only missing ranges and keeps warm-cache reuse visible', () => {
    const estimate = estimateAgentTimelineAnalysis({
      scope: { kind: 'selection', sourceRanges: [{ start: 0, end: 60 }] },
      profile: getAgentTimelineProfileSettings('balanced'),
      channels: ['cuts', 'quality', 'people', 'audio'],
      cachedCoverage: [
        { channel: 'cuts', ranges: [{ start: 0, end: 60 }] },
        { channel: 'quality', ranges: [{ start: 0, end: 20 }, { start: 40, end: 60 }] },
      ],
      sourceFrameRate: 25,
    });
    expect(estimate.channels.find((item) => item.channel === 'cuts')).toMatchObject({
      uncachedDurationSeconds: 0,
      reusableDurationSeconds: 60,
      estimatedWorkItems: 0,
      workItemKind: 'frames',
    });
    expect(estimate.channels.find((item) => item.channel === 'quality')).toMatchObject({
      uncachedDurationSeconds: 20,
      reusableDurationSeconds: 40,
      estimatedWorkItems: 40,
      workItemKind: 'samples',
    });
    expect(estimate.uncachedDurationSeconds).toBe(60);
    expect(estimate.notes[0]).toContain('does not start');
  });

  it('does not invent wall time without a matching benchmark', () => {
    const estimate = estimateAgentTimelineAnalysis({
      scope: { kind: 'source', sourceRanges: [{ start: 0, end: 120 }] },
      profile: getAgentTimelineProfileSettings('quick'),
      channels: ['cuts'],
      cachedCoverage: [],
      sourceFrameRate: 30,
    });
    expect(estimate.estimatedWallTimeSeconds).toBeUndefined();
    expect(estimate.channels[0].estimatedWorkItems).toBe(3600);
  });

  it('uses supplied real-device rates and reports downloads separately', () => {
    const estimate = estimateAgentTimelineAnalysis({
      scope: { kind: 'in-out', sourceRanges: [{ start: 10, end: 40 }] },
      profile: getAgentTimelineProfileSettings('deep'),
      channels: ['text', 'active-speaker'],
      cachedCoverage: [],
      uncachedShotCount: 6,
      ambiguousSpeechSeconds: 4,
      downloads: [
        { id: 'ocr-eng', bytes: 1_000, cached: false, kind: 'language-pack' },
        { id: 'mouth-model', bytes: 2_000, cached: true, kind: 'model' },
      ],
      benchmark: {
        profile: 'deep',
        minimumSecondsPerMediaSecond: 0.5,
        maximumSecondsPerMediaSecond: 0.8,
        platform: 'windows',
        deviceClass: 'fixture',
      },
    });
    expect(estimate.channels.find((item) => item.channel === 'text')?.estimatedWorkItems).toBe(18);
    expect(estimate.channels.find((item) => item.channel === 'active-speaker')?.estimatedWorkItems).toBe(32);
    expect(estimate.estimatedWallTimeSeconds).toMatchObject({ minimum: 15, maximum: 24 });
    expect(estimate.downloads).toMatchObject({ requiredBytes: 1_000, reusableBytes: 2_000 });
  });

  it('merges overlapping scope and coverage ranges deterministically', () => {
    const estimate = estimateAgentTimelineAnalysis({
      scope: {
        kind: 'used-ranges',
        sourceRanges: [{ start: 0, end: 10 }, { start: 8, end: 20 }],
      },
      profile: getAgentTimelineProfileSettings('balanced'),
      channels: ['camera-motion'],
      cachedCoverage: [{
        channel: 'camera-motion',
        ranges: [{ start: 5, end: 15 }],
      }],
    });
    expect(estimate.totalDurationSeconds).toBe(20);
    expect(estimate.channels[0]).toMatchObject({
      uncachedDurationSeconds: 10,
      reusableDurationSeconds: 10,
      estimatedWorkItems: 20,
    });
  });

  it('uses the union of missing channel ranges for uncached source duration', () => {
    const estimate = estimateAgentTimelineAnalysis({
      scope: { kind: 'source', sourceRanges: [{ start: 0, end: 60 }] },
      profile: getAgentTimelineProfileSettings('quick'),
      channels: ['cuts', 'quality'],
      cachedCoverage: [
        { channel: 'cuts', ranges: [{ start: 30, end: 60 }] },
        { channel: 'quality', ranges: [{ start: 0, end: 30 }] },
      ],
      sourceFrameRate: 25,
    });
    expect(estimate.channels.map((channel) => channel.uncachedDurationSeconds)).toEqual([30, 30]);
    expect(estimate.uncachedDurationSeconds).toBe(60);
  });

  it('rejects invalid custom settings and mismatched benchmark profiles', () => {
    expect(() => estimateAgentTimelineAnalysis({
      scope: { kind: 'source', sourceRanges: [{ start: 0, end: 1 }] },
      profile: {
        ...getAgentTimelineProfileSettings('quick'),
        profile: 'custom',
        audioHopSeconds: 0,
      },
      channels: ['audio'],
      cachedCoverage: [],
    })).toThrow('audio hop');
    expect(() => estimateAgentTimelineAnalysis({
      scope: { kind: 'source', sourceRanges: [{ start: 0, end: 1 }] },
      profile: getAgentTimelineProfileSettings('quick'),
      channels: ['cuts'],
      cachedCoverage: [],
      benchmark: {
        profile: 'balanced',
        minimumSecondsPerMediaSecond: 1,
        maximumSecondsPerMediaSecond: 2,
        platform: 'test',
        deviceClass: 'test',
      },
    })).toThrow('does not match');
    expect(() => estimateAgentTimelineAnalysis({
      scope: { kind: 'source', sourceRanges: [{ start: 0, end: 1 }] },
      profile: getAgentTimelineProfileSettings('quick'),
      channels: ['cuts'],
      cachedCoverage: [],
      benchmark: {
        profile: 'quick',
        minimumSecondsPerMediaSecond: 2,
        maximumSecondsPerMediaSecond: 1,
        platform: 'test',
        deviceClass: 'test',
      },
    })).toThrow('ordered');
  });
});
