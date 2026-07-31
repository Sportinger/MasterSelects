import { describe, expect, it } from 'vitest';

import {
  applyStoryboardEvidenceRepair,
  assessStoryboardDuration,
  evaluateStoryboardCoverage,
  resolveStoryboardEvidenceRef,
  type StoryboardEvidenceMoment,
} from '../../src/services/storyboard/coverage';
import type {
  StoryboardCandidate,
  StoryboardEvidenceRef,
  StoryboardGenerationBrief,
  StoryboardProjectState,
  StoryboardScene,
} from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip } from '../../src/types/timeline';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';

const scene: StoryboardScene = {
  schemaVersion: 1,
  id: 'scene-coverage',
  planId: 'plan-coverage',
  title: 'Opening',
  description: 'Establish the city and the protagonist.',
  targetDurationSeconds: 8,
  status: 'ready',
  filledClipIds: [],
  evidenceRefIds: [],
  variantSetIds: [],
  createdAt: 1,
  updatedAt: 1,
};

const sourceMedia: MediaFile = {
  id: 'media-source',
  name: 'Interview source',
  type: 'video',
  parentId: null,
  createdAt: 1,
  url: 'blob:source',
  duration: 60,
  fileHash: 'source-hash-a',
};

const generatedMedia: MediaFile = {
  id: 'media-generated',
  name: 'Generated opening',
  type: 'video',
  parentId: null,
  createdAt: 2,
  url: 'blob:generated',
  duration: 8,
  fileHash: 'generated-hash-a',
};

function projectState(input: {
  evidence?: StoryboardEvidenceRef[];
  candidates?: StoryboardCandidate[];
  brief?: StoryboardGenerationBrief;
} = {}): StoryboardProjectState {
  const base = createEmptyStoryboardStoreProjectState();
  const evidence = input.evidence ?? [];
  const candidates = input.candidates ?? [];
  return {
    ...base,
    scenes: {
      [scene.id]: {
        ...scene,
        evidenceRefIds: evidence.map(ref => ref.id),
        selectedCandidateId: candidates.find(candidate => candidate.state === 'accepted')?.id,
      },
    },
    evidenceRefs: Object.fromEntries(evidence.map(ref => [ref.id, ref])),
    candidates: Object.fromEntries(candidates.map(candidate => [candidate.id, candidate])),
    generationBriefs: input.brief ? { [input.brief.id]: input.brief } : {},
  };
}

function transcriptRef(): Extract<StoryboardEvidenceRef, { kind: 'transcript-moment' }> {
  return {
    schemaVersion: 1,
    id: 'evidence-transcript',
    sceneId: scene.id,
    kind: 'transcript-moment',
    handle: '$m-old',
    indexVersion: 'transcript-v1',
    createdAt: 1,
  };
}

function sourceRangeRef(): Extract<StoryboardEvidenceRef, { kind: 'source-range' }> {
  return {
    schemaVersion: 1,
    id: 'evidence-range',
    sceneId: scene.id,
    kind: 'source-range',
    mediaFileId: sourceMedia.id,
    start: 10,
    end: 15,
    createdAt: 1,
  };
}

function generationBrief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-r1',
    sceneId: scene.id,
    revision: 1,
    prompt: 'A wide cinematic establishing shot of the city at dawn.',
    durationSeconds: 8,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 2,
  };
}

function candidate(state: StoryboardCandidate['state']): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: `candidate-${state}`,
    sceneId: scene.id,
    kind: 'generated-video',
    state,
    mediaFileId: generatedMedia.id,
    sourceMomentHandles: [],
    durationSeconds: 8,
    createdAt: 3,
  };
}

function filledClip(id: string, startTime: number, duration: number): TimelineClip {
  return {
    id,
    trackId: 'video-filled',
    name: id,
    file: new File([], `${id}.mp4`),
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'video', mediaFileId: sourceMedia.id },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

describe('storyboard evidence repair', () => {
  it('repairs a stale version only through an explicit verified alias', () => {
    const ref = transcriptRef();
    const repairedMoment: StoryboardEvidenceMoment = {
      handle: '$m-new',
      indexVersion: 'transcript-v2',
      mediaFileId: sourceMedia.id,
      startSeconds: 10,
      endSeconds: 12,
      excerpt: 'The city wakes.',
      legacyHandles: [{ handle: ref.handle, indexVersion: ref.indexVersion }],
    };
    const resolution = resolveStoryboardEvidenceRef({
      ref,
      mediaFiles: [sourceMedia],
      candidates: {},
      momentIndex: { version: 'transcript-v2', moments: [repairedMoment] },
    });

    expect(resolution.status).toBe('repairable');
    expect(resolution.detail).toContain('repair to $m-new');
    expect(applyStoryboardEvidenceRepair(resolution)).toEqual({
      ...ref,
      handle: '$m-new',
      indexVersion: 'transcript-v2',
    });
  });

  it('keeps an unresolved stale handle visible and refuses a guessed repair', () => {
    const resolution = resolveStoryboardEvidenceRef({
      ref: transcriptRef(),
      mediaFiles: [],
      candidates: {},
      momentIndex: { version: 'transcript-v2', moments: [] },
    });
    expect(resolution.status).toBe('stale');
    expect(resolution.detail).toContain('Refresh the index');
    expect(() => applyStoryboardEvidenceRepair(resolution)).toThrow('no verified repair');
  });
});

describe('storyboard coverage evaluation', () => {
  it('keeps source coverage and generation readiness separate with deterministic reasons and fingerprint', async () => {
    const state = projectState({
      evidence: [sourceRangeRef()],
      brief: generationBrief(),
      candidates: [candidate('processing')],
    });
    const first = await evaluateStoryboardCoverage({
      state,
      sceneId: scene.id,
      mediaFiles: [generatedMedia, sourceMedia],
      capabilityAvailability: { video: true },
      evaluatedAt: 100,
    });
    const second = await evaluateStoryboardCoverage({
      state,
      sceneId: scene.id,
      mediaFiles: [sourceMedia, generatedMedia],
      capabilityAvailability: { video: true },
      evaluatedAt: 999,
    });

    expect(first.coverage.sourceScore).toBe(0.85);
    expect(first.coverage.generationReadinessScore).toBeGreaterThan(first.coverage.sourceScore / 2);
    expect(first.coverage.level).toBe('green');
    expect(second.coverage.reasons).toEqual(first.coverage.reasons);
    expect(second.coverage.evaluatedAgainstFingerprint).toEqual(
      first.coverage.evaluatedAgainstFingerprint,
    );
    expect(second.coverage.evaluatedAt).toBe(999);
  });

  it('changes the fingerprint when underlying media changes and describes honest red/yellow/green routes', async () => {
    const empty = await evaluateStoryboardCoverage({
      state: projectState(),
      sceneId: scene.id,
      mediaFiles: [],
      evaluatedAt: 1,
    });
    expect(empty.coverage.level).toBe('red');
    expect(empty.coverage.reasons).toContain('Source gap: no source or generated candidate is attached.');

    const pendingState = projectState({
      brief: generationBrief(),
      candidates: [candidate('processing')],
    });
    const pending = await evaluateStoryboardCoverage({
      state: pendingState,
      sceneId: scene.id,
      mediaFiles: [generatedMedia],
      capabilityAvailability: { video: true },
      evaluatedAt: 2,
    });
    expect(pending.coverage.level).toBe('yellow');

    const acceptedState = projectState({
      brief: generationBrief(),
      candidates: [candidate('accepted')],
    });
    const accepted = await evaluateStoryboardCoverage({
      state: acceptedState,
      sceneId: scene.id,
      mediaFiles: [generatedMedia],
      capabilityAvailability: { video: true },
      evaluatedAt: 3,
    });
    const changed = await evaluateStoryboardCoverage({
      state: acceptedState,
      sceneId: scene.id,
      mediaFiles: [{ ...generatedMedia, fileHash: 'generated-hash-b' }],
      capabilityAvailability: { video: true },
      evaluatedAt: 4,
    });
    expect(accepted.coverage.level).toBe('green');
    expect(accepted.coverage.sourceScore).toBe(1);
    expect(changed.coverage.evaluatedAgainstFingerprint.value)
      .not.toBe(accepted.coverage.evaluatedAgainstFingerprint.value);
  });

  it('reports deterministic gaps for unusable candidates and accepted candidates with missing media', async () => {
    const failedState = projectState({
      candidates: [candidate('rejected'), candidate('failed'), candidate('canceled')],
    });
    const first = await evaluateStoryboardCoverage({
      state: failedState,
      sceneId: scene.id,
      mediaFiles: [],
      evaluatedAt: 5,
    });
    const second = await evaluateStoryboardCoverage({
      state: {
        ...failedState,
        candidates: Object.fromEntries(Object.entries(failedState.candidates).reverse()),
      },
      sceneId: scene.id,
      mediaFiles: [],
      evaluatedAt: 6,
    });
    expect(first.coverage.level).toBe('red');
    expect(first.coverage.reasons).toContain(
      'Source gap: candidate output is unavailable (canceled, failed, rejected).',
    );
    expect(second.coverage.reasons).toEqual(first.coverage.reasons);

    const acceptedMissing = await evaluateStoryboardCoverage({
      state: projectState({ candidates: [candidate('accepted')] }),
      sceneId: scene.id,
      mediaFiles: [],
      evaluatedAt: 7,
    });
    expect(acceptedMissing.coverage.level).toBe('red');
    expect(acceptedMissing.coverage.reasons).toContain(
      'Source gap: an accepted candidate exists, but its media is missing.',
    );
  });
});

describe('storyboard target/actual duration', () => {
  it('uses the clipped union of filled intervals so overlaps count once', () => {
    const a = filledClip('filled-a', 0, 5);
    const b = filledClip('filled-b', 3, 5);
    const c = filledClip('filled-c', 9, 4);
    const card = createStoryboardTimelineClip({
      trackId: 'storyboard-track',
      planId: scene.planId,
      sceneId: scene.id,
      clipId: 'scene-card',
      startTime: 0,
      durationSeconds: 10,
      targetDurationSeconds: 8,
      properties: { filledClipIds: [c.id, a.id, b.id] },
    });
    const assessment = assessStoryboardDuration({ sceneClip: card, clips: [c, card, b, a] });

    expect(assessment.actualSeconds).toBe(9);
    expect(assessment.unionSegments).toEqual([
      { startTime: 0, endTime: 8, clipIds: ['filled-a', 'filled-b'] },
      { startTime: 9, endTime: 10, clipIds: ['filled-c'] },
    ]);
    expect(assessment.tone).toBe('yellow');
    expect(assessment.accessibleLabel).toContain('Duration differs from target');
  });

  it('is green inside tolerance and red only for an explicit violated constraint', () => {
    const close = filledClip('filled-close', 0, 7.8);
    const long = filledClip('filled-long', 0, 9);
    const card = createStoryboardTimelineClip({
      trackId: 'storyboard-track',
      planId: scene.planId,
      sceneId: scene.id,
      clipId: 'scene-card',
      startTime: 0,
      durationSeconds: 10,
      targetDurationSeconds: 8,
      properties: { filledClipIds: [close.id, long.id] },
    });

    expect(assessStoryboardDuration({
      sceneClip: { ...card, storyboardProperties: { ...card.storyboardProperties!, filledClipIds: [close.id] } },
      clips: [close],
    }).tone).toBe('green');
    expect(assessStoryboardDuration({
      sceneClip: { ...card, storyboardProperties: { ...card.storyboardProperties!, filledClipIds: [long.id] } },
      clips: [long],
    }).tone).toBe('yellow');
    expect(assessStoryboardDuration({
      sceneClip: { ...card, storyboardProperties: { ...card.storyboardProperties!, filledClipIds: [long.id] } },
      clips: [long],
      constraint: { maxSeconds: 8.2, label: 'Trailer beat' },
    }).tone).toBe('red');
  });
});
