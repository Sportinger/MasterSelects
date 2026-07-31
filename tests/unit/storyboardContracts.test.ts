import { describe, expect, it } from 'vitest';
import {
  KERNEL_STORYBOARD_RESPONSE_STATUSES,
  STORYBOARD_SCHEMA_VERSION,
  assertNeverKernelResponse,
  createStoryboardFingerprintInput,
  hashStoryboardFingerprintInput,
  parseKernelStoryboardResponse,
  stableStringifyStoryboardFingerprintInput,
  type KernelStoryboardResponse,
  type StoryboardClipProperties,
  type StoryboardGenerationBrief,
  type StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardProjectState } from '../../src/services/project/storyboard';

const fingerprint = {
  schemaVersion: 1,
  algorithm: 'sha-256',
  value: 'a'.repeat(64),
} as const;

const generationBrief: StoryboardGenerationBrief = {
  schemaVersion: 1,
  id: 'brief-1',
  sceneId: 'scene-1',
  revision: 1,
  prompt: 'Slow dolly toward the subject.',
  durationSeconds: 5,
  aspectRatio: '16:9',
  referenceMediaFileIds: ['media-reference'],
  capabilityPolicy: {
    mediaType: 'video',
    needsImageToVideo: true,
    preferredQuality: 'balanced',
  },
  createdAt: 10,
};

function fingerprintState(): StoryboardProjectState {
  const state = createEmptyStoryboardProjectState();
  state.plans['plan-1'] = {
    schemaVersion: 1,
    id: 'plan-1',
    title: 'Launch film',
    sceneIds: ['scene-1'],
    createdAt: 1,
    updatedAt: 2,
  };
  state.scenes['scene-1'] = {
    schemaVersion: 1,
    id: 'scene-1',
    planId: 'plan-1',
    title: 'Opening',
    description: 'Introduce the product.',
    targetDurationSeconds: 5,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 2,
  };
  state.generationBriefs[generationBrief.id] = generationBrief;
  return state;
}

function labelResponse(response: KernelStoryboardResponse): string {
  switch (response.status) {
    case 'planned':
      return 'plan';
    case 'awaiting-decision':
      return 'decision';
    case 'variant-planned':
      return 'variant';
    case 'compiled':
      return 'execute';
    case 'aborted':
    case 'failed':
      return 'decline';
    default:
      return assertNeverKernelResponse(response);
  }
}

describe('storyboard v1 contracts', () => {
  it('freezes the clip-local scene projection without requiring TimelineClip changes', () => {
    const projection: StoryboardClipProperties = {
      schemaVersion: STORYBOARD_SCHEMA_VERSION,
      planId: 'plan-1',
      sceneId: 'scene-1',
      title: 'Opening',
      description: 'Introduce the product.',
      targetDurationSeconds: 5,
      status: 'ready',
    };

    expect(projection).toEqual(expect.objectContaining({
      schemaVersion: 1,
      planId: 'plan-1',
      sceneId: 'scene-1',
    }));
  });

  it('builds deterministic fingerprint inputs independent of record and selection order', async () => {
    const state = fingerprintState();
    const reordered: StoryboardProjectState = {
      ...state,
      scenes: Object.fromEntries(Object.entries(state.scenes).toReversed()),
      plans: Object.fromEntries(Object.entries(state.plans).toReversed()),
    };
    const first = createStoryboardFingerprintInput(state, {
      planId: 'plan-1',
      sceneIds: ['scene-1', 'scene-1'],
      generationBriefIds: ['brief-1'],
      candidateIds: [],
      evidenceRefIds: [],
      variantOptionIds: [],
      decisionIds: [],
      includeCoverage: true,
      referencedMedia: [
        { mediaFileId: 'media-z', contentFingerprint: 'z' },
        { mediaFileId: 'media-a', contentFingerprint: 'a' },
      ],
    });
    const second = createStoryboardFingerprintInput(reordered, {
      planId: 'plan-1',
      sceneIds: ['scene-1'],
      generationBriefIds: ['brief-1', 'brief-1'],
      candidateIds: [],
      evidenceRefIds: [],
      variantOptionIds: [],
      decisionIds: [],
      includeCoverage: true,
      referencedMedia: [
        { mediaFileId: 'media-a', contentFingerprint: 'a' },
        { mediaFileId: 'media-z', contentFingerprint: 'z' },
      ],
    });

    expect(stableStringifyStoryboardFingerprintInput(first))
      .toBe(stableStringifyStoryboardFingerprintInput(second));
    expect(await hashStoryboardFingerprintInput(first))
      .toEqual(await hashStoryboardFingerprintInput(second));

    second.scenes[0] = { ...second.scenes[0], title: 'Changed opening' };
    expect(stableStringifyStoryboardFingerprintInput(first))
      .not.toBe(stableStringifyStoryboardFingerprintInput(second));
  });

  it('parses every frozen kernel response branch exhaustively', () => {
    const responses = [
      {
        runId: 'run-plan',
        status: 'planned',
        message: 'I drafted the scenes.',
        resolvedCalls: [],
        planSummary: { sceneCount: 3 },
      },
      {
        runId: 'run-decision',
        status: 'awaiting-decision',
        message: 'Choose a direction.',
        decision: {
          id: 'decision-1',
          kind: 'story',
          question: 'Which opening?',
          baseFingerprint: fingerprint,
          options: [{
            id: 'option-a',
            title: 'Direct',
            summary: 'Open on the product.',
            rationale: 'Fastest setup.',
            tradeoffs: ['Less mystery'],
            estimatedCredits: 0,
            preview: { sceneId: 'scene-1' },
          }],
          allowMultiple: false,
          allowFreeform: true,
        },
      },
      {
        runId: 'run-variant',
        status: 'variant-planned',
        message: 'Three directions are ready to build.',
        variantSet: {
          scope: {
            startTime: 10,
            endTime: 20,
            trackIds: ['track-1'],
            includeLinked: true,
          },
          baseFingerprint: fingerprint,
          options: [{
            id: 'variant-a',
            title: 'Conservative',
            rationale: 'Preserve the existing rhythm.',
            resolvedCalls: [],
            generationBriefs: [generationBrief],
          }],
        },
      },
      {
        runId: 'run-execute',
        status: 'compiled',
        mode: 'story',
        taskContract: { kind: 'story-edit' },
        resolvedCalls: [{
          stepId: 'step-1',
          tool: 'updateStoryboardScene',
          args: { sceneId: 'scene-1' },
        }],
        expectedFingerprint: fingerprint,
        summary: { changedScenes: ['scene-1'] },
      },
      {
        runId: 'run-aborted',
        status: 'aborted',
        failures: [],
        reason: 'staleDecision',
      },
      {
        runId: 'run-failed',
        status: 'failed',
        failures: [{ code: 'invalid-snapshot' }],
        message: 'Snapshot rejected.',
      },
    ].map(parseKernelStoryboardResponse);

    expect(responses.map((response) => response.status))
      .toEqual(KERNEL_STORYBOARD_RESPONSE_STATUSES);
    expect(responses.map(labelResponse))
      .toEqual(['plan', 'decision', 'variant', 'execute', 'decline', 'decline']);
    expect(responses[1]).toMatchObject({
      status: 'awaiting-decision',
      decision: {
        allowFreeform: true,
        options: [{ tradeoffs: ['Less mystery'] }],
      },
    });
  });

  it('rejects unknown or incomplete kernel response variants', () => {
    expect(() => parseKernelStoryboardResponse({
      runId: 'run-unknown',
      status: 'execute',
    })).toThrow(/unknown kernel response status/);
    expect(() => parseKernelStoryboardResponse({
      runId: 'run-decision',
      status: 'awaiting-decision',
      message: 'Choose.',
      decision: {
        id: 'decision-1',
        kind: 'story',
        question: 'Which?',
        options: [],
      },
    })).toThrow(/baseFingerprint/);
  });
});
