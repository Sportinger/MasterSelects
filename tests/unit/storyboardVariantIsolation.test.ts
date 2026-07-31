import { describe, expect, it } from 'vitest';
import {
  assertVariantIsolation,
  captureVariantRangeSnapshot,
  fingerprintVariantRangeSnapshot,
  type VariantTimelineSourceSnapshot,
} from '../../src/services/storyboard/variants';

function source(includeLinked = false): VariantTimelineSourceSnapshot {
  return {
    schemaVersion: 1,
    compositionId: 'composition-1',
    scope: {
      startTime: 10,
      endTime: 20,
      trackIds: ['video-1'],
      includeLinked,
    },
    boundaryPaddingSeconds: 2,
    tracks: [
      { id: 'video-1', kind: 'video', payload: { locked: false } },
      { id: 'video-2', kind: 'video', payload: { locked: false } },
      { id: 'audio-1', kind: 'audio', payload: { muted: false } },
    ],
    clips: [
      {
        id: 'inside',
        trackId: 'video-1',
        startTime: 12,
        endTime: 18,
        linkedClipIds: ['linked-audio'],
        payload: { version: 1 },
      },
      {
        id: 'boundary',
        trackId: 'video-1',
        startTime: 8.5,
        endTime: 11,
        linkedClipIds: [],
        payload: { version: 1 },
      },
      {
        id: 'outside-time',
        trackId: 'video-1',
        startTime: 30,
        endTime: 35,
        linkedClipIds: [],
        payload: { version: 1 },
      },
      {
        id: 'outside-track',
        trackId: 'video-2',
        startTime: 12,
        endTime: 18,
        linkedClipIds: [],
        payload: { version: 1 },
      },
      {
        id: 'linked-audio',
        trackId: 'audio-1',
        startTime: 12,
        endTime: 18,
        linkedClipIds: [],
        payload: { version: 1 },
      },
      {
        id: 'unlinked-audio',
        trackId: 'audio-1',
        startTime: 12,
        endTime: 18,
        linkedClipIds: [],
        payload: { version: 1 },
      },
    ],
    transitions: [],
    globalState: { frameRate: 30 },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function compare(
  beforeSource: VariantTimelineSourceSnapshot,
  afterSource: VariantTimelineSourceSnapshot,
  boundaryPolicy: 'preserve' | 'rebuild' = 'preserve',
) {
  const before = captureVariantRangeSnapshot(beforeSource);
  const expected = await fingerprintVariantRangeSnapshot(before);
  return assertVariantIsolation({
    before,
    after: captureVariantRangeSnapshot(afterSource),
    expectedBaseFingerprint: expected.scope,
    expectedBoundaryFingerprint: expected.boundary,
    boundaryPolicy,
  });
}

describe('storyboard variant isolation harness', () => {
  it('allows selected interior changes but rejects time- and track-outside mutations', async () => {
    const baseline = source();
    const insideChange = clone(baseline);
    insideChange.clips.find((clip) => clip.id === 'inside')!.payload.version = 2;
    expect(await compare(baseline, insideChange)).toMatchObject({ ok: true });

    const outsideTimeChange = clone(baseline);
    outsideTimeChange.clips.find((clip) => clip.id === 'outside-time')!.payload.version = 2;
    const outsideTimeResult = await compare(baseline, outsideTimeChange);
    expect(outsideTimeResult).toMatchObject({
      ok: false,
      violations: [{ kind: 'outside-mutation' }],
    });

    const outsideTrackChange = clone(baseline);
    outsideTrackChange.clips.find((clip) => clip.id === 'outside-track')!.payload.version = 2;
    const outsideTrackResult = await compare(baseline, outsideTrackChange);
    expect(outsideTrackResult).toMatchObject({
      ok: false,
      violations: [{ kind: 'outside-mutation' }],
    });
  });

  it('enforces includeLinked instead of treating an entire linked track as mutable', async () => {
    const excluded = source(false);
    const excludedAfter = clone(excluded);
    excludedAfter.clips.find((clip) => clip.id === 'linked-audio')!.payload.version = 2;
    expect(await compare(excluded, excludedAfter)).toMatchObject({
      ok: false,
      violations: [{ kind: 'outside-mutation' }],
    });

    const included = source(true);
    const includedAfter = clone(included);
    includedAfter.clips.find((clip) => clip.id === 'linked-audio')!.payload.version = 2;
    expect(await compare(included, includedAfter)).toMatchObject({ ok: true });

    const unrelatedAfter = clone(included);
    unrelatedAfter.clips.find((clip) => clip.id === 'unlinked-audio')!.payload.version = 2;
    expect(await compare(included, unrelatedAfter)).toMatchObject({
      ok: false,
      violations: [{ kind: 'outside-mutation' }],
    });
  });

  it('applies boundary policy explicitly and detects stale base fingerprints', async () => {
    const baseline = source();
    const boundaryChange = clone(baseline);
    boundaryChange.clips.find((clip) => clip.id === 'boundary')!.payload.version = 2;
    expect(await compare(baseline, boundaryChange, 'preserve')).toMatchObject({
      ok: false,
      violations: [{ kind: 'boundary-mutation' }],
    });
    expect(await compare(baseline, boundaryChange, 'rebuild')).toMatchObject({ ok: true });

    const before = captureVariantRangeSnapshot(baseline);
    const after = captureVariantRangeSnapshot(clone(baseline));
    const actual = await fingerprintVariantRangeSnapshot(before);
    const stale = await assertVariantIsolation({
      before,
      after,
      expectedBaseFingerprint: { ...actual.scope, value: '0'.repeat(64) },
      expectedBoundaryFingerprint: actual.boundary,
      boundaryPolicy: 'preserve',
    });
    expect(stale).toMatchObject({
      ok: false,
      violations: [{ kind: 'stale-scope' }],
    });
  });
});
