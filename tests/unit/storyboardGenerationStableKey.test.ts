import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudVideoCreate = vi.hoisted(() => vi.fn());
const runProviderJob = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/cloudApi', () => ({
  cloudApi: {
    ai: {
      video: {
        create: cloudVideoCreate,
      },
    },
  },
}));

vi.mock('../../src/services/flashboard/FlashBoardProviderRunners', () => ({
  resumeFlashBoardProviderJob: vi.fn(),
  runFlashBoardProviderJob: runProviderJob,
}));

import { cloudAiService } from '../../src/services/cloudAiService';
import {
  FLASHBOARD_CANCEL_REQUESTED_ERROR,
  flashBoardJobService,
} from '../../src/services/flashboard/FlashBoardJobService';

describe('storyboard generation stable hosted seams', () => {
  beforeEach(() => {
    cloudVideoCreate.mockReset();
    runProviderJob.mockReset();
    flashBoardJobService.setUpdateCallback(null);
  });

  it('passes the prepared idempotency key into hosted image task creation', async () => {
    cloudVideoCreate.mockResolvedValue({
      data: { taskId: 'hosted-image-task' },
      status: 'accepted',
    });

    await expect(cloudAiService.createTextToImage({
      provider: 'nano-banana-2',
      prompt: 'A storyboard concept frame.',
      aspectRatio: '16:9',
      resolution: '1K',
      outputFormat: 'png',
    }, 'storyboard-generation:batch:0')).resolves.toBe('hosted-image-task');

    expect(cloudVideoCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      idempotencyKey: 'storyboard-generation:batch:0',
      params: expect.objectContaining({
        outputType: 'image',
        provider: 'nano-banana-2',
      }),
    }));
  });

  it('deduplicates record submission and reports running cancellation as billable', async () => {
    runProviderJob.mockImplementation(() => new Promise(() => undefined));
    const updates: Array<{ status: string; error?: string }> = [];
    flashBoardJobService.setUpdateCallback((_recordId, update) => {
      updates.push(update);
    });
    const input = {
      recordId: 'storyboard-record-running',
      request: {
        service: 'cloud' as const,
        providerId: 'cloud-kling',
        version: 'latest',
        idempotencyKey: 'storyboard-generation:batch:1',
        outputType: 'video' as const,
        prompt: 'A cinematic move.',
        duration: 5,
        referenceMediaFileIds: [],
      },
    };

    flashBoardJobService.submit(input);
    flashBoardJobService.submit(input);
    expect(runProviderJob).toHaveBeenCalledTimes(1);

    expect(flashBoardJobService.cancel(input.recordId)).toMatchObject({
      billingMayContinue: true,
      disposition: 'cancel-requested',
      recordId: input.recordId,
    });
    expect(updates.at(-1)).toEqual(expect.objectContaining({
      status: 'processing',
      error: FLASHBOARD_CANCEL_REQUESTED_ERROR,
    }));
  });
});
