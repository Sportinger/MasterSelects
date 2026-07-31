import { describe, expect, it } from 'vitest';
import {
  StoryboardContractError,
  type StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  createEmptyStoryboardProjectState,
  decodeStoryboardProjectState,
  encodeStoryboardProjectState,
  migrateProjectWithStoryboard,
  readStoryboardProjectState,
} from '../../src/services/project/storyboard';

const fingerprint = {
  schemaVersion: 1,
  algorithm: 'sha-256',
  value: 'b'.repeat(64),
} as const;

function completeState(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      'plan-1': {
        schemaVersion: 1,
        id: 'plan-1',
        title: 'Portrait',
        sceneIds: ['scene-1'],
        targetDurationSeconds: 30,
        createdAt: 1,
        updatedAt: 2,
      },
    },
    scenes: {
      'scene-1': {
        schemaVersion: 1,
        id: 'scene-1',
        planId: 'plan-1',
        title: 'Arrival',
        description: 'The subject enters the room.',
        intent: 'Establish character and place.',
        targetDurationSeconds: 6,
        status: 'review',
        generationBriefId: 'brief-1',
        selectedCandidateId: 'candidate-1',
        filledClipIds: [],
        evidenceRefIds: ['evidence-1'],
        variantSetIds: ['variant-set-1'],
        createdAt: 1,
        updatedAt: 2,
      },
    },
    generationBriefs: {
      'brief-1': {
        schemaVersion: 1,
        id: 'brief-1',
        sceneId: 'scene-1',
        revision: 1,
        prompt: 'A quiet observational entrance.',
        durationSeconds: 6,
        aspectRatio: '16:9',
        referenceMediaFileIds: ['reference-1'],
        capabilityPolicy: {
          mediaType: 'video',
          needsStartEndFrames: true,
          preferredQuality: 'balanced',
        },
        createdAt: 2,
      },
    },
    candidates: {
      'candidate-1': {
        schemaVersion: 1,
        id: 'candidate-1',
        sceneId: 'scene-1',
        kind: 'generated-video',
        state: 'ready',
        generationBriefRevision: 1,
        generationRequestKey: 'request-1',
        generationRecordId: 'generation-1',
        outputId: 'output-1',
        mediaFileId: 'media-1',
        sourceMomentHandles: [],
        durationSeconds: 6,
        estimatedCredits: 12,
        actualCredits: 11,
        createdAt: 3,
      },
    },
    evidenceRefs: {
      'evidence-1': {
        schemaVersion: 1,
        id: 'evidence-1',
        sceneId: 'scene-1',
        kind: 'source-range',
        mediaFileId: 'source-1',
        start: 4,
        end: 10,
        createdAt: 2,
      },
    },
    coverageBySceneId: {
      'scene-1': {
        schemaVersion: 1,
        sceneId: 'scene-1',
        level: 'green',
        sourceScore: 0.8,
        generationReadinessScore: 1,
        reasons: ['A ready candidate exists.'],
        evaluatedAgainstFingerprint: fingerprint,
        evaluatedAt: 4,
      },
    },
    variantSets: {
      'variant-set-1': {
        schemaVersion: 1,
        id: 'variant-set-1',
        title: 'Arrival alternatives',
        baseCompositionId: 'composition-1',
        sceneIds: ['scene-1'],
        scope: {
          startTime: 4,
          endTime: 10,
          trackIds: ['track-1'],
          includeLinked: true,
        },
        baseFingerprint: fingerprint,
        boundaryFingerprint: fingerprint,
        status: 'review',
        optionIds: ['variant-option-1'],
        createdAt: 4,
      },
    },
    variantOptions: {
      'variant-option-1': {
        schemaVersion: 1,
        id: 'variant-option-1',
        variantSetId: 'variant-set-1',
        title: 'Quiet',
        rationale: 'Preserve room tone.',
        state: 'ready',
        fragment: {
          schemaVersion: 1,
          durationSeconds: 6,
          tracks: [{
            localTrackId: 'local-track-1',
            sourceTrackId: 'track-1',
            kind: 'video',
          }],
          clips: [{
            localId: 'local-clip-1',
            sourceClipId: 'clip-1',
            localTrackId: 'local-track-1',
            startOffsetSeconds: 0,
            durationSeconds: 6,
            payload: { sourceStart: 4 },
          }],
          links: [],
          keyframes: [],
          effects: [],
          masks: [],
          transitions: [],
          markers: [],
          annotations: [],
          sceneIds: ['scene-1'],
          candidateIds: ['candidate-1'],
          warnings: [],
        },
        candidateIds: ['candidate-1'],
        expectedFingerprint: fingerprint,
        lineage: {
          kind: 'refinement',
          parentOptionIds: ['variant-option-parent'],
          instruction: 'Keep the opening.',
          lockedSubranges: [{ startTime: 4, endTime: 6 }],
        },
      },
    },
    decisions: {
      'decision-1': {
        schemaVersion: 1,
        id: 'decision-1',
        kind: 'variant',
        question: 'Which arrival?',
        explanation: 'Both options satisfy the beat.',
        state: 'resolved',
        baseFingerprint: fingerprint,
        options: [{
          id: 'decision-option-1',
          title: 'Quiet',
          summary: 'Use room tone.',
          tradeoffs: ['Less energy'],
        }],
        allowMultiple: false,
        allowFreeform: true,
        selectedOptionIds: ['decision-option-1'],
        variantSetId: 'variant-set-1',
        createdAt: 4,
        resolvedAt: 5,
      },
    },
    templates: {
      'template-1': {
        schemaVersion: 1,
        id: 'template-1',
        name: 'Interview portrait',
        version: 1,
        description: 'Character-focused short portrait.',
        targetDurationSeconds: 60,
        aspectRatio: '16:9',
        beats: [{
          id: 'beat-1',
          title: 'Arrival',
          purpose: 'Introduce the subject.',
          targetShare: 0.1,
          defaultSceneKind: 'hook',
          evidenceExpectations: ['Clean establishing shot'],
          generationDefaults: {
            durationSeconds: 6,
            aspectRatio: '16:9',
            referenceMediaFileIds: [],
            prompt: 'Observational arrival.',
          },
        }],
      },
    },
  };
}

describe('storyboard project codec', () => {
  it('round-trips the complete v1 normalized state without sharing references', () => {
    const original = completeState();
    const encoded = encodeStoryboardProjectState(original);
    const decoded = decodeStoryboardProjectState(
      JSON.parse(JSON.stringify(encoded)),
    );

    expect(decoded).toEqual({ source: 'v1', state: original });
    expect(decoded.state).not.toBe(original);
    expect(decoded.state.scenes['scene-1']).not.toBe(original.scenes['scene-1']);
  });

  it('migrates an old project with no storyboard field to an empty v1 state', () => {
    const oldProject = {
      version: 1,
      name: 'Legacy edit',
      compositions: [],
    };
    const decoded = readStoryboardProjectState(oldProject);
    const migrated = migrateProjectWithStoryboard(oldProject);

    expect(decoded).toEqual({
      source: 'missing',
      state: createEmptyStoryboardProjectState(),
    });
    expect(migrated).toEqual({
      ...oldProject,
      storyboard: createEmptyStoryboardProjectState(),
    });
    expect(oldProject).not.toHaveProperty('storyboard');
  });

  it('fails closed for corrupt, unsupported, or binary-bearing storyboard data', () => {
    expect(() => decodeStoryboardProjectState({
      ...createEmptyStoryboardProjectState(),
      schemaVersion: 2,
    })).toThrow(StoryboardContractError);

    const corrupt = completeState() as StoryboardProjectState & {
      hiddenPreview?: string;
    };
    corrupt.hiddenPreview = 'data:image/png;base64,AAAA';
    expect(() => encodeStoryboardProjectState(corrupt))
      .toThrow(/inline binary data/);

    const withRemoteUrl = completeState() as StoryboardProjectState & {
      providerUrl?: string;
    };
    withRemoteUrl.providerUrl = 'https://provider.example/output.mp4';
    expect(() => encodeStoryboardProjectState(withRemoteUrl))
      .toThrow(/remote URLs/);
  });
});
