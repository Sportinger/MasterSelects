import {
  FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY,
  mergeFlashBoardVideoJobRecovery,
  persistFlashBoardVideoJobRecovery,
  readFlashBoardVideoJobRecovery,
} from '../../src/services/flashboard/FlashBoardVideoJobRecovery';
import type { FlashBoardActiveGenerationRecord } from '../../src/stores/flashboardStore/types';

function createVideoRecord(
  input: Partial<FlashBoardActiveGenerationRecord> = {},
): FlashBoardActiveGenerationRecord {
  return {
    id: 'record-1',
    kind: 'generation',
    createdAt: 100,
    updatedAt: 200,
    request: {
      service: 'cloud',
      providerId: 'cloud-kling',
      version: 'latest',
      idempotencyKey: 'flashboard-video:record-1',
      outputType: 'video',
      prompt: 'A continuous cinematic shot',
      referenceMediaFileIds: [],
    },
    job: {
      status: 'processing',
      remoteTaskId: 'task-123',
    },
    ...input,
  };
}

describe('FlashBoard video job recovery', () => {
  beforeEach(() => {
    localStorage.removeItem(FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY);
  });

  it('persists active video jobs immediately and keeps projects isolated', () => {
    const record = createVideoRecord();

    persistFlashBoardVideoJobRecovery([record], 'project-created-at');

    expect(readFlashBoardVideoJobRecovery('project-created-at')).toEqual([record]);
    expect(readFlashBoardVideoJobRecovery('another-project')).toEqual([]);
  });

  it('prefers a recovered provider task id over a stale project snapshot', () => {
    const staleProjectRecord = createVideoRecord({
      updatedAt: 150,
      job: { status: 'queued' },
    });
    const recoveredRecord = createVideoRecord({
      updatedAt: 200,
      job: {
        status: 'processing',
        remoteTaskId: 'task-from-provider',
      },
    });

    expect(mergeFlashBoardVideoJobRecovery(
      [staleProjectRecord],
      [recoveredRecord],
    )[0]?.job).toEqual({
      status: 'processing',
      remoteTaskId: 'task-from-provider',
    });
  });

  it('removes terminal jobs from the recovery registry', () => {
    const record = createVideoRecord();
    persistFlashBoardVideoJobRecovery([record], 'project-created-at');

    persistFlashBoardVideoJobRecovery([
      createVideoRecord({
        updatedAt: 300,
        job: { status: 'completed', remoteTaskId: 'task-123' },
      }),
    ], 'project-created-at');

    expect(readFlashBoardVideoJobRecovery('project-created-at')).toEqual([]);
    expect(localStorage.getItem(FLASHBOARD_VIDEO_JOB_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});
