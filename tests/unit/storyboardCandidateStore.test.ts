import { afterEach, describe, expect, it } from 'vitest';
import {
  reconcileStoryboardGenerationRecord,
  selectStoryboardCandidateByProvenance,
  selectStoryboardCandidatesForGenerationRecord,
  selectStoryboardCandidatesForScene,
  setStoryboardCandidateState,
} from '../../src/services/storyboard/candidates';
import {
  createStoryboardGenerationBriefRevision,
  selectStoryboardGenerationBriefRevisions,
  type StoryboardGenerationBriefRevisionValues,
} from '../../src/services/storyboard/generation';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
  StoryboardScene,
} from '../../src/services/storyboard/contracts';
import {
  createEmptyStoryboardStoreProjectState,
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../src/stores/storyboardStore';
import type { FlashBoardActiveGenerationRecord } from '../../src/stores/flashboardStore/types';

function scene(): StoryboardScene {
  return {
    schemaVersion: 1,
    id: 'scene-1',
    planId: 'plan-1',
    title: 'Opening',
    description: 'Introduce the subject.',
    targetDurationSeconds: 6,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function projectState(): StoryboardProjectState {
  const state = createEmptyStoryboardStoreProjectState();
  state.plans['plan-1'] = {
    schemaVersion: 1,
    id: 'plan-1',
    title: 'Portrait',
    sceneIds: ['scene-1'],
    createdAt: 1,
    updatedAt: 1,
  };
  state.scenes['scene-1'] = scene();
  return state;
}

function record(
  jobStatus: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled',
  resultMediaFileId?: string,
): FlashBoardActiveGenerationRecord {
  return {
    id: 'record-1',
    kind: 'generation',
    createdAt: 20,
    updatedAt: 30,
    request: {
      service: 'cloud',
      providerId: 'provider-video',
      version: 'v1',
      idempotencyKey: 'request-1',
      outputType: 'video',
      prompt: 'A quiet entrance.',
      duration: 6,
      referenceMediaFileIds: [],
    },
    job: { status: jobStatus },
    outputs: [{
      id: 'output-1',
      mediaType: 'video',
      availability: jobStatus === 'completed' ? 'completed' : 'preview',
    }],
    results: resultMediaFileId
      ? [{
          outputId: 'output-1',
          mediaFileId: resultMediaFileId,
          mediaType: 'video',
          duration: 6,
        }]
      : undefined,
  };
}

const briefValues = {
  prompt: 'Observational entrance.',
  durationSeconds: 6,
  aspectRatio: '16:9',
  referenceMediaFileIds: ['reference-1'],
  capabilityPolicy: {
    mediaType: 'video',
    preferredQuality: 'balanced',
  },
} satisfies StoryboardGenerationBriefRevisionValues;

afterEach(() => {
  resetStoryboardProjectState();
});

describe('storyboard candidate and brief state', () => {
  it('creates immutable brief revisions and leaves candidate provenance pinned', () => {
    const initial = projectState();
    const first = createStoryboardGenerationBriefRevision(initial, {
      ...briefValues,
      createdAt: 10,
      expectedPreviousRevision: 0,
      sceneId: 'scene-1',
    });
    const candidate: StoryboardCandidate = {
      schemaVersion: 1,
      id: 'candidate-1',
      sceneId: 'scene-1',
      kind: 'generated-video',
      state: 'ready',
      generationBriefRevision: first.brief.revision,
      generationRecordId: 'record-old',
      outputId: 'output-old',
      mediaFileId: 'media-old',
      sourceMomentHandles: [],
      createdAt: 11,
    };
    first.state.candidates[candidate.id] = candidate;
    const second = createStoryboardGenerationBriefRevision(first.state, {
      ...briefValues,
      prompt: 'More handheld movement.',
      createdAt: 12,
      expectedPreviousRevision: 1,
      sceneId: 'scene-1',
    });

    expect(selectStoryboardGenerationBriefRevisions(second.state, 'scene-1'))
      .toEqual([first.brief, second.brief]);
    expect(second.brief).toMatchObject({ revision: 2, prompt: 'More handheld movement.' });
    expect(second.state.scenes['scene-1'].generationBriefId).toBe(second.brief.id);
    expect(second.state.candidates['candidate-1'].generationBriefRevision).toBe(1);
    expect(initial.generationBriefs).toEqual({});
    expect(() => createStoryboardGenerationBriefRevision(second.state, {
      ...briefValues,
      createdAt: 13,
      expectedPreviousRevision: 1,
      sceneId: 'scene-1',
    })).toThrow(/revision conflict/);
  });

  it('reconciles queued, imported, accepted, and stale reload states honestly', () => {
    const queued = reconcileStoryboardGenerationRecord(projectState(), {
      generationBriefRevision: 1,
      record: record('queued'),
      sceneId: 'scene-1',
    });
    const candidateId = queued.candidates[0].id;
    expect(queued.state.scenes['scene-1'].status).toBe('generating');
    expect(queued.candidates[0].state).toBe('queued');

    const ready = reconcileStoryboardGenerationRecord(queued.state, {
      generationBriefRevision: 1,
      record: record('completed', 'media-1'),
      sceneId: 'scene-1',
    });
    expect(ready.candidates[0]).toMatchObject({
      id: candidateId,
      state: 'ready',
      mediaFileId: 'media-1',
    });
    expect(ready.state.scenes['scene-1'].status).toBe('review');

    const accepted = setStoryboardCandidateState(ready.state, candidateId, 'accepted');
    expect(accepted.scenes['scene-1'].status).toBe('accepted');
    const staleReload = reconcileStoryboardGenerationRecord(accepted, {
      generationBriefRevision: 1,
      record: record('processing'),
      sceneId: 'scene-1',
    });
    expect(staleReload.candidates[0]).toMatchObject({
      id: candidateId,
      state: 'accepted',
      mediaFileId: 'media-1',
    });
    expect(staleReload.state.scenes['scene-1'].status).toBe('accepted');
    hydrateStoryboardProjectState(staleReload.state);
    expect(getStoryboardProjectSnapshot().candidates[candidateId])
      .toEqual(staleReload.candidates[0]);
  });

  it.each(['failed', 'canceled'] as const)(
    'does not leave a scene generating after its only job becomes %s',
    (terminalStatus) => {
      const queued = reconcileStoryboardGenerationRecord(projectState(), {
        generationBriefRevision: 1,
        record: record('queued'),
        sceneId: 'scene-1',
      });
      const terminal = reconcileStoryboardGenerationRecord(queued.state, {
        generationBriefRevision: 1,
        record: record(terminalStatus),
        sceneId: 'scene-1',
      });

      expect(terminal.candidates[0].state).toBe(terminalStatus);
      expect(terminal.state.scenes['scene-1'].status).toBe('ready');
    },
  );

  it('selects normalized candidates deterministically by scene and provenance', () => {
    const state = projectState();
    const first = reconcileStoryboardGenerationRecord(state, {
      generationBriefRevision: 1,
      record: {
        ...record('processing'),
        outputs: [
          {
            id: 'output-z',
            mediaType: 'video',
            availability: 'preview',
          },
          {
            id: 'output-a',
            mediaType: 'video',
            availability: 'preview',
          },
        ],
      },
      sceneId: 'scene-1',
    }).state;
    const recordCandidates = selectStoryboardCandidatesForGenerationRecord(
      first,
      'record-1',
    );

    expect(recordCandidates.map((candidate) => candidate.outputId))
      .toEqual(['output-a', 'output-z']);
    expect(selectStoryboardCandidatesForScene(first, 'scene-1').map(({ id }) => id))
      .toEqual(recordCandidates.map(({ id }) => id).toSorted());
    expect(selectStoryboardCandidateByProvenance(first, {
      generationRecordId: 'record-1',
      outputId: 'output-z',
    })?.outputId).toBe('output-z');
  });

  it('keeps a prepared candidate ID when provider output provenance arrives later', () => {
    const state = projectState();
    state.candidates['candidate-prepared'] = {
      schemaVersion: 1,
      id: 'candidate-prepared',
      sceneId: 'scene-1',
      kind: 'generated-video',
      state: 'awaiting-approval',
      generationBriefRevision: 1,
      generationRequestKey: 'request-1',
      generationRecordId: 'record-1',
      sourceMomentHandles: [],
      estimatedCredits: 12,
      rationale: 'Prepared before paid submission.',
      createdAt: 15,
    };

    const reconciled = reconcileStoryboardGenerationRecord(state, {
      generationBriefRevision: 2,
      record: record('processing'),
      sceneId: 'scene-1',
    });

    expect(reconciled.candidates).toEqual([
      expect.objectContaining({
        id: 'candidate-prepared',
        state: 'processing',
        outputId: 'output-1',
        generationBriefRevision: 1,
        estimatedCredits: 12,
        rationale: 'Prepared before paid submission.',
        createdAt: 15,
      }),
    ]);
    expect(reconciled.state.candidates).toHaveProperty('candidate-prepared');
  });

  it('hydrates and snapshots project content without sharing mutable references', () => {
    const state = projectState();
    const created = createStoryboardGenerationBriefRevision(state, {
      ...briefValues,
      createdAt: 10,
      sceneId: 'scene-1',
    });

    hydrateStoryboardProjectState(created.state);
    created.state.scenes['scene-1'].title = 'Mutated caller state';
    const snapshot = getStoryboardProjectSnapshot();
    snapshot.scenes['scene-1'].title = 'Mutated snapshot';

    expect(useStoryboardStore.getState().scenes['scene-1'].title).toBe('Opening');
    expect(useStoryboardStore.getState().generationBriefs[created.brief.id])
      .not.toBe(created.brief);

    const storeBrief = useStoryboardStore.getState().createGenerationBriefRevision({
      ...briefValues,
      prompt: 'Revision created through the store.',
      createdAt: 11,
      expectedPreviousRevision: 1,
      sceneId: 'scene-1',
    });
    expect(storeBrief.revision).toBe(2);
    expect(getStoryboardProjectSnapshot().generationBriefs[storeBrief.id]).toEqual(storeBrief);
  });
});
