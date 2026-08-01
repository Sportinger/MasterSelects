import { describe, expect, it } from 'vitest';
import {
  adaptFlashBoardGenerationRecord,
  createGenerationCandidateId,
  deriveGenerationCandidateState,
} from '../../src/services/storyboard/candidates';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardJobState,
} from '../../src/stores/flashboardStore/types';

function generationRecord(
  overrides: Partial<FlashBoardActiveGenerationRecord> = {},
): FlashBoardActiveGenerationRecord {
  return {
    id: 'record-1',
    kind: 'generation',
    createdAt: 10,
    updatedAt: 20,
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
    job: { status: 'queued' },
    ...overrides,
  };
}

function recordWithStatus(status: FlashBoardJobState['status']): FlashBoardActiveGenerationRecord {
  return generationRecord({ job: { status } });
}

describe('storyboard generation-record candidate adapter', () => {
  it('maps multi-output records deterministically across output and result ordering', () => {
    const record = generationRecord({
      job: { status: 'completed' },
      outputs: [
        {
          id: 'output-b',
          mediaType: 'video',
          availability: 'completed',
          downloadUrl: 'https://provider.invalid/raw-b.mp4',
          previewUrl: 'https://provider.invalid/preview-b.mp4',
          duration: 8,
        },
        {
          id: 'output-a',
          mediaType: 'image',
          availability: 'completed',
          artworkUrl: 'https://provider.invalid/raw-a.png',
        },
      ],
      results: [{
        outputId: 'output-a',
        mediaFileId: 'media-a',
        mediaType: 'image',
      }],
    });

    const first = adaptFlashBoardGenerationRecord({
      generationBriefRevision: 3,
      record,
      sceneId: 'scene-1',
    });
    const second = adaptFlashBoardGenerationRecord({
      generationBriefRevision: 3,
      record: {
        ...record,
        outputs: record.outputs?.toReversed(),
        results: record.results?.toReversed(),
      },
      sceneId: 'scene-1',
    });

    expect(first).toEqual(second);
    expect(first).toEqual([
      expect.objectContaining({
        id: createGenerationCandidateId('record-1', { outputId: 'output-a' }),
        sceneId: 'scene-1',
        kind: 'generated-image',
        state: 'ready',
        generationBriefRevision: 3,
        generationRequestKey: 'request-1',
        generationRecordId: 'record-1',
        outputId: 'output-a',
        mediaFileId: 'media-a',
      }),
      expect.objectContaining({
        id: createGenerationCandidateId('record-1', { outputId: 'output-b' }),
        kind: 'generated-video',
        state: 'processing',
        outputId: 'output-b',
        durationSeconds: 8,
      }),
    ]);
    expect(JSON.stringify(first)).not.toContain('provider.invalid');
  });

  it.each([
    ['draft', 'awaiting-approval'],
    ['queued', 'queued'],
    ['processing', 'processing'],
    ['completed', 'processing'],
    ['failed', 'failed'],
    ['canceled', 'canceled'],
  ] as const)('derives %s jobs as %s before a local import', (jobStatus, expected) => {
    expect(deriveGenerationCandidateState(recordWithStatus(jobStatus), {})).toBe(expected);
  });

  it('treats an imported result as ready even when the provider record later says canceled', () => {
    const record = generationRecord({
      job: { status: 'canceled' },
      result: {
        mediaFileId: 'media-completed',
        mediaType: 'video',
        duration: 6,
      },
    });
    const candidates = adaptFlashBoardGenerationRecord({
      generationBriefRevision: 1,
      record,
      sceneId: 'scene-1',
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: createGenerationCandidateId('record-1', {
          mediaFileId: 'media-completed',
        }),
        state: 'ready',
        mediaFileId: 'media-completed',
        durationSeconds: 6,
      }),
    ]);
  });

  it('uses a stable record-level identity while an output identity is not known', () => {
    const input = {
      generationBriefRevision: 1,
      record: generationRecord(),
      sceneId: 'scene-1',
    };

    expect(adaptFlashBoardGenerationRecord(input)).toEqual([
      expect.objectContaining({
        id: createGenerationCandidateId('record-1', {}),
        state: 'queued',
      }),
    ]);
    expect(adaptFlashBoardGenerationRecord(input))
      .toEqual(adaptFlashBoardGenerationRecord(input));
  });
});
