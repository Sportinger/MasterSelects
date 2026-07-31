import { describe, expect, it } from 'vitest';
import type {
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../src/services/storyboard/contracts';
import {
  captureVariantRangeSnapshot,
  fingerprintVariantRangeSnapshot,
  type VariantTimelineSourceSnapshot,
} from '../../src/services/storyboard/variants';
import {
  createEmptyStoryboardVariantState,
  reduceStoryboardVariantState,
  restoreStoryboardVariantState,
  serializeStoryboardVariantState,
} from '../../src/stores/storyboardVariantStore';

function source(): VariantTimelineSourceSnapshot {
  return {
    schemaVersion: 1,
    compositionId: 'composition-1',
    scope: {
      startTime: 10,
      endTime: 20,
      trackIds: ['video-1'],
      includeLinked: false,
    },
    boundaryPaddingSeconds: 2,
    tracks: [{ id: 'video-1', kind: 'video', payload: { locked: false } }],
    clips: [{
      id: 'clip-1',
      trackId: 'video-1',
      startTime: 10,
      endTime: 20,
      linkedClipIds: [],
      payload: { label: 'base' },
    }],
    transitions: [],
    globalState: { frameRate: 30 },
  };
}

describe('storyboard variant normalized state', () => {
  it('serializes and restores canonical sets, options, and range snapshots', async () => {
    const snapshot = captureVariantRangeSnapshot(source());
    const fingerprints = await fingerprintVariantRangeSnapshot(snapshot);
    const variantSet: TimelineVariantSet = {
      schemaVersion: 1,
      id: 'set-1',
      title: 'Selected range',
      baseCompositionId: 'composition-1',
      sceneIds: ['scene-1'],
      scope: snapshot.scope,
      baseFingerprint: fingerprints.scope,
      boundaryFingerprint: fingerprints.boundary,
      status: 'building',
      optionIds: [],
      createdAt: 1,
    };
    const option: TimelineVariantOption = {
      schemaVersion: 1,
      id: 'option-1',
      variantSetId: variantSet.id,
      title: 'Option A',
      rationale: 'Preserve the current structure.',
      state: 'planned',
      fragment: {
        schemaVersion: 1,
        durationSeconds: 10,
        tracks: [],
        clips: [],
        links: [],
        keyframes: [],
        effects: [],
        masks: [],
        transitions: [],
        markers: [],
        annotations: [],
        sceneIds: ['scene-1'],
        candidateIds: [],
        warnings: [],
      },
      candidateIds: [],
      expectedFingerprint: fingerprints.scope,
    };

    let state = createEmptyStoryboardVariantState();
    state = reduceStoryboardVariantState(state, { type: 'put-set', variantSet });
    state = reduceStoryboardVariantState(state, { type: 'put-option', option });
    state = reduceStoryboardVariantState(state, {
      type: 'attach-snapshot',
      variantSetId: variantSet.id,
      snapshot,
    });
    const restored = restoreStoryboardVariantState(
      JSON.parse(serializeStoryboardVariantState(state)),
    );

    expect(restored).toEqual(state);
    expect(restored).not.toBe(state);
    expect(restored.variantSets['set-1'].optionIds).toEqual(['option-1']);

    const stale = reduceStoryboardVariantState(restored, {
      type: 'mark-stale',
      variantSetId: 'set-1',
    });
    expect(stale.variantSets['set-1'].status).toBe('stale');
    expect(restored.variantSets['set-1'].status).toBe('building');
  });

  it('rejects orphaned options and snapshots during mutation or restore', () => {
    const state = createEmptyStoryboardVariantState();
    expect(() => reduceStoryboardVariantState(state, {
      type: 'attach-snapshot',
      variantSetId: 'missing',
      snapshot: captureVariantRangeSnapshot(source()),
    })).toThrow(/missing set/);

    expect(() => restoreStoryboardVariantState({
      ...state,
      variantOptions: {
        orphan: {
          schemaVersion: 1,
          id: 'orphan',
          variantSetId: 'missing',
          title: 'Orphan',
          rationale: 'Invalid fixture.',
          state: 'planned',
          fragment: {
            schemaVersion: 1,
            durationSeconds: 1,
            tracks: [],
            clips: [],
            links: [],
            keyframes: [],
            effects: [],
            masks: [],
            transitions: [],
            markers: [],
            annotations: [],
            sceneIds: [],
            candidateIds: [],
            warnings: [],
          },
          candidateIds: [],
        },
      },
    })).toThrow(/not registered/);
  });
});
