import { describe, expect, it } from 'vitest';
import {
  promoteStoryboardConceptCandidate,
  resolveStoryboardCandidateAwareAnimaticFramePayload,
} from '../../src/services/storyboard/animaticCandidates';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import { createStoryboardTimelineClip } from '../../src/services/storyboard/core';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';

const track: TimelineTrack = {
  id: 'storyboard-track',
  name: 'Storyboard',
  type: 'video',
  height: 80,
  muted: false,
  visible: true,
  solo: false,
};

const conceptFile: MediaFile = {
  id: 'concept-file',
  name: 'Concept',
  type: 'image',
  parentId: null,
  createdAt: 1,
  url: 'blob:concept',
};

const timelineStillFile: MediaFile = {
  id: 'timeline-still-file',
  name: 'Timeline still',
  type: 'image',
  parentId: null,
  createdAt: 1,
  url: 'blob:timeline-still',
};

function conceptCandidate(): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: 'concept-candidate',
    sceneId: 'scene-integration',
    kind: 'generated-image',
    state: 'ready',
    generationBriefRevision: 1,
    generationRequestKey: 'storyboard-generation:concept:0',
    generationRecordId: 'record-concept',
    outputId: 'output-concept',
    mediaFileId: conceptFile.id,
    sourceMomentHandles: [],
    durationSeconds: 5,
    createdAt: 10,
  };
}

function projectState(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-integration'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-integration': {
        schemaVersion: 1,
        id: 'scene-integration',
        planId: 'plan',
        title: 'Integration scene',
        description: 'Candidate-aware preview.',
        targetDurationSeconds: 5,
        status: 'review',
        generationBriefId: 'brief-integration:r1',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {
      'brief-integration:r1': {
        schemaVersion: 1,
        id: 'brief-integration:r1',
        sceneId: 'scene-integration',
        revision: 1,
        prompt: 'A quiet exterior at blue hour.',
        durationSeconds: 5,
        aspectRatio: '16:9',
        referenceMediaFileIds: [],
        capabilityPolicy: { mediaType: 'video' },
        createdAt: 1,
      },
    },
    candidates: {
      'concept-candidate': conceptCandidate(),
    },
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

function scene(filledClipIds: string[] = []): TimelineClip {
  return createStoryboardTimelineClip({
    trackId: track.id,
    planId: 'plan',
    sceneId: 'scene-integration',
    clipId: 'scene-card',
    startTime: 2,
    durationSeconds: 8,
    targetDurationSeconds: 5,
    title: 'Integration scene',
    description: 'Candidate-aware preview.',
    status: filledClipIds.length ? 'filled' : 'review',
    properties: { filledClipIds },
  });
}

function filledClip(
  id: string,
  type: 'image' | 'video',
  mediaFileId: string,
): TimelineClip {
  return {
    id,
    trackId: track.id,
    name: id,
    file: new File([], `${id}.${type === 'image' ? 'png' : 'mp4'}`),
    startTime: 2,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    source: {
      type,
      mediaFileId,
      ...(type === 'image' ? { imageUrl: timelineStillFile.url } : {}),
    },
    mediaFileId,
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

function resolve(input: {
  clips: TimelineClip[];
  mode: 'preview' | 'animatic-export' | 'normal-export';
  state: StoryboardProjectState;
}) {
  return resolveStoryboardCandidateAwareAnimaticFramePayload({
    clips: input.clips,
    tracks: [track],
    mediaFiles: [conceptFile, timelineStillFile],
    time: 6,
    width: 1920,
    height: 1080,
    mode: input.mode,
    cameraMove: 'push-in',
    watermark: 'ANIMATIC',
    state: input.state,
  });
}

describe('storyboard candidate-aware animatic integration', () => {
  it('replaces only an unfilled slate after explicit card/reference promotion', () => {
    const unpromoted = projectState();
    expect(resolve({
      clips: [scene()],
      mode: 'preview',
      state: unpromoted,
    })?.kind).toBe('slate');

    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'concept-candidate',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: unpromoted,
    }).state;
    const preview = resolve({
      clips: [scene()],
      mode: 'preview',
      state: promoted,
    });
    const animaticExport = resolve({
      clips: [scene()],
      mode: 'animatic-export',
      state: promoted,
    });

    expect(preview).toMatchObject({
      kind: 'still-image',
      startTime: 2,
      endTime: 10,
      durationSeconds: 8,
      still: {
        mediaFileId: conceptFile.id,
        imageUrl: conceptFile.url,
      },
    });
    expect(animaticExport).toEqual({
      ...preview,
      mode: 'animatic-export',
    });
    expect(resolve({
      clips: [scene()],
      mode: 'normal-export',
      state: promoted,
    })).toBeNull();
  });

  it('keeps real filled timeline media above every candidate-backed fallback', () => {
    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'concept-candidate',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: projectState(),
    }).state;
    const still = filledClip('timeline-still', 'image', timelineStillFile.id);
    const video = filledClip('timeline-video', 'video', 'timeline-video-file');

    expect(resolve({
      clips: [scene([still.id]), still],
      mode: 'preview',
      state: promoted,
    })).toMatchObject({
      kind: 'still-image',
      still: {
        clipId: still.id,
        mediaFileId: timelineStillFile.id,
        imageUrl: timelineStillFile.url,
      },
    });
    expect(resolve({
      clips: [scene([video.id]), video],
      mode: 'animatic-export',
      state: promoted,
    })?.kind).toBe('real-media');
  });
});
