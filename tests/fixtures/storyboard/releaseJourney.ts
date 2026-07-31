import type {
  StoryboardCandidate,
  StoryboardDecision,
  StoryboardProjectState,
  TimelineFragment,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../../src/services/storyboard/contracts';
import {
  captureVariantRangeSnapshot,
  fingerprintVariantRangeSnapshot,
  type VariantMaterializationIdFactory,
  type VariantRangeSnapshot,
  type VariantTimelineSourceSnapshot,
} from '../../../src/services/storyboard/variants';
import type { Composition } from '../../../src/stores/mediaStore/types';
import type {
  SerializableClip,
  TimelineTrack,
} from '../../../src/types/timeline';

export const RELEASE_COMPOSITION_ID = 'release-base-composition';
export const RELEASE_PLAN_ID = 'release-plan';
export const RELEASE_SCENE_ID = 'release-scene';
export const RELEASE_VARIANT_SET_ID = 'release-variant-set';

export const releaseTrack: TimelineTrack = {
  id: 'release-video-track',
  name: 'Release video',
  type: 'video',
  height: 64,
  muted: false,
  visible: true,
  solo: false,
};

export function createReleaseClip(
  id: string,
  startTime: number,
  duration: number,
  mediaFileId = `media-${id}`,
): SerializableClip {
  return {
    id,
    trackId: releaseTrack.id,
    name: id,
    mediaFileId,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    sourceType: 'video',
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
  };
}

export function createReleaseBaseComposition(): Composition {
  return {
    id: RELEASE_COMPOSITION_ID,
    name: 'Release base',
    type: 'composition',
    parentId: null,
    createdAt: 1,
    width: 1920,
    height: 1080,
    frameRate: 30,
    duration: 30,
    backgroundColor: '#000000',
    timelineData: {
      tracks: [structuredClone(releaseTrack)],
      clips: [
        createReleaseClip('release-before', 0, 10),
        createReleaseClip('release-selected', 10, 10),
        createReleaseClip('release-after', 20, 10),
      ],
      playheadPosition: 10,
      duration: 30,
      zoom: 100,
      scrollX: 0,
      inPoint: 10,
      outPoint: 20,
      loopPlayback: false,
    },
  };
}

export function createReleaseVariantSource(): VariantTimelineSourceSnapshot {
  return {
    schemaVersion: 1,
    compositionId: RELEASE_COMPOSITION_ID,
    scope: {
      startTime: 10,
      endTime: 20,
      trackIds: [releaseTrack.id],
      includeLinked: false,
    },
    boundaryPaddingSeconds: 1,
    tracks: [{
      id: releaseTrack.id,
      kind: 'video',
      payload: { locked: false },
    }],
    clips: [
      {
        id: 'release-before',
        trackId: releaseTrack.id,
        startTime: 0,
        endTime: 10,
        linkedClipIds: [],
        payload: { mediaFileId: 'media-release-before' },
      },
      {
        id: 'release-selected',
        trackId: releaseTrack.id,
        startTime: 10,
        endTime: 20,
        linkedClipIds: [],
        payload: { mediaFileId: 'media-release-selected' },
      },
      {
        id: 'release-after',
        trackId: releaseTrack.id,
        startTime: 20,
        endTime: 30,
        linkedClipIds: [],
        payload: { mediaFileId: 'media-release-after' },
      },
    ],
    transitions: [],
    globalState: { frameRate: 30 },
  };
}

function createReleaseFragment(
  optionId: string,
  mediaFileId: string,
): TimelineFragment {
  const payload = createReleaseClip(
    `payload-${optionId}`,
    0,
    10,
    mediaFileId,
  );
  return {
    schemaVersion: 1,
    durationSeconds: 10,
    tracks: [{
      localTrackId: 'release-local-video',
      sourceTrackId: releaseTrack.id,
      kind: 'video',
    }],
    clips: [{
      localId: `fragment-${optionId}`,
      localTrackId: 'release-local-video',
      startOffsetSeconds: 0,
      durationSeconds: 10,
      payload: structuredClone(payload) as never,
    }],
    links: [],
    keyframes: [],
    effects: [],
    masks: [],
    transitions: [],
    markers: [],
    annotations: [],
    sceneIds: [RELEASE_SCENE_ID],
    candidateIds: [],
    warnings: [],
  };
}

export interface StoryboardReleaseJourneyFixture {
  baseComposition: Composition;
  candidates: Record<string, StoryboardCandidate>;
  options: TimelineVariantOption[];
  rangeSnapshot: VariantRangeSnapshot;
  variantSet: TimelineVariantSet;
}

export async function createStoryboardReleaseJourneyFixture():
Promise<StoryboardReleaseJourneyFixture> {
  const rangeSnapshot = captureVariantRangeSnapshot(createReleaseVariantSource());
  const fingerprints = await fingerprintVariantRangeSnapshot(rangeSnapshot);
  const variantSet: TimelineVariantSet = {
    schemaVersion: 1,
    id: RELEASE_VARIANT_SET_ID,
    title: 'Release range options',
    baseCompositionId: RELEASE_COMPOSITION_ID,
    sceneIds: [RELEASE_SCENE_ID],
    scope: rangeSnapshot.scope,
    baseFingerprint: fingerprints.scope,
    boundaryFingerprint: fingerprints.boundary,
    status: 'building',
    optionIds: ['release-option-a', 'release-option-b', 'release-option-c'],
    createdAt: 10,
  };
  const options: TimelineVariantOption[] = [
    {
      schemaVersion: 1,
      id: 'release-option-a',
      variantSetId: variantSet.id,
      title: 'Balanced',
      rationale: 'Preserve clarity and pacing.',
      state: 'planned',
      fragment: createReleaseFragment('a', 'media-option-a'),
      candidateIds: [],
    },
    {
      schemaVersion: 1,
      id: 'release-option-b',
      variantSetId: variantSet.id,
      title: 'Dynamic',
      rationale: 'Increase momentum.',
      state: 'building',
      fragment: createReleaseFragment('b', 'media-option-b'),
      candidateIds: ['candidate-option-b'],
    },
    {
      schemaVersion: 1,
      id: 'release-option-c',
      variantSetId: variantSet.id,
      title: 'Alternative',
      rationale: 'Use a distinct visual angle.',
      state: 'building',
      fragment: createReleaseFragment('c', 'media-option-c'),
      candidateIds: ['candidate-option-c'],
    },
  ];
  const candidate = (
    id: string,
    state: StoryboardCandidate['state'],
    createdAt: number,
  ): StoryboardCandidate => ({
    schemaVersion: 1,
    id,
    sceneId: RELEASE_SCENE_ID,
    kind: 'generated-video',
    state,
    sourceMomentHandles: [],
    createdAt,
  });
  return {
    baseComposition: createReleaseBaseComposition(),
    candidates: {
      'candidate-option-b': candidate('candidate-option-b', 'ready', 20),
      'candidate-option-c': candidate('candidate-option-c', 'processing', 21),
    },
    options,
    rangeSnapshot,
    variantSet,
  };
}

export function createReleaseMaterializationIdFactory(prefix = 'release'):
VariantMaterializationIdFactory {
  let index = 0;
  return (kind, sourceId) => (
    `${prefix}-${kind}-${++index}-${sourceId.replaceAll('\u0000', '-')}`
  );
}

export function createReleaseStoryboardProjectState(input: {
  candidates?: Readonly<Record<string, StoryboardCandidate>>;
  decision: StoryboardDecision;
  options: readonly TimelineVariantOption[];
  variantSet: TimelineVariantSet;
}): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      [RELEASE_PLAN_ID]: {
        schemaVersion: 1,
        id: RELEASE_PLAN_ID,
        title: 'Release plan',
        sceneIds: [RELEASE_SCENE_ID],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      [RELEASE_SCENE_ID]: {
        schemaVersion: 1,
        id: RELEASE_SCENE_ID,
        planId: RELEASE_PLAN_ID,
        title: 'Release scene',
        description: 'A scene used by the cross-lane release journey.',
        targetDurationSeconds: 10,
        status: 'review',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [input.variantSet.id],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {},
    candidates: structuredClone(input.candidates ?? {}),
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {
      [input.variantSet.id]: structuredClone(input.variantSet),
    },
    variantOptions: Object.fromEntries(
      input.options.map((option) => [option.id, structuredClone(option)]),
    ),
    decisions: {
      [input.decision.id]: structuredClone(input.decision),
    },
    templates: {},
  };
}
