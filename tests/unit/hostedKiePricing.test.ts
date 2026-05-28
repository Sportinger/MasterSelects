import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  calculateHostedSeedanceCost,
  calculateHostedSunoCost,
  createHostedSeedanceTask,
  getHostedKlingTask,
} from '../../functions/lib/kieai';
import type { Env } from '../../functions/lib/env';
import { getModelCreditCost } from '../../functions/lib/modelPricing';
import { getFlashBoardPriceEstimate } from '../../src/services/flashboard/FlashBoardPricing';

describe('hosted Kie.ai pricing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('charges hosted Kling 3.0 at the 6x MasterSelects cloud multiplier', () => {
    expect(calculateHostedKlingCost('std', 10, false)).toBe(840);
    expect(calculateHostedKlingCost('std', 10, true)).toBe(1200);
    expect(calculateHostedKlingCost('pro', 10, false)).toBe(1080);
    expect(calculateHostedKlingCost('pro', 10, true)).toBe(1620);
  });

  it('charges hosted Nano Banana 2 image generation at the 6x cloud multiplier', () => {
    expect(calculateHostedImageCost('nano-banana-2', '1K')).toBe(48);
    expect(calculateHostedImageCost('nano-banana-2', '2K')).toBe(72);
    expect(calculateHostedImageCost('nano-banana-2', '4K')).toBe(108);
  });

  it('charges hosted Suno music generation through MasterSelects Cloud credits', () => {
    expect(calculateHostedSunoCost()).toBe(72);
    expect(getFlashBoardPriceEstimate({
      outputType: 'audio',
      providerId: 'suno-music',
      service: 'cloud',
    })?.compactLabel).toBe('72 cr');
  });

  it('charges hosted Seedance 2.0 at the 6x MasterSelects cloud multiplier', () => {
    expect(calculateHostedSeedanceCost('bytedance/seedance-2', '480p', 10)).toBe(1140);
    expect(calculateHostedSeedanceCost('bytedance/seedance-2', '720p', 10)).toBe(2460);
    expect(calculateHostedSeedanceCost('bytedance/seedance-2', '1080p', 10)).toBe(6120);
    expect(calculateHostedSeedanceCost('bytedance/seedance-2-fast', '480p', 10)).toBe(930);
    expect(calculateHostedSeedanceCost('bytedance/seedance-2-fast', '720p', 10)).toBe(1980);

    expect(getFlashBoardPriceEstimate({
      duration: 10,
      mode: '720p',
      outputType: 'video',
      providerId: 'bytedance/seedance-2-fast',
      service: 'cloud',
    })?.compactLabel).toBe('1980 cr');
  });

  it('uploads hosted Seedance audio references into reference_audio_urls', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/voice-drive',
          fileUrl: 'https://cdn.example.com/voice-drive.wav',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'seedance_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedSeedanceTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      aspectRatio: '16:9',
      duration: 8,
      mode: '720p',
      prompt: 'A presenter speaks naturally on camera.',
      provider: 'bytedance/seedance-2',
      referenceMedia: [
        {
          fileName: 'voice-drive.wav',
          mediaType: 'audio',
          mimeType: 'audio/wav',
          source: 'data:audio/wav;base64,UklGRg==',
        },
      ],
      sound: true,
    })).resolves.toEqual({ taskId: 'seedance_task_1' });

    const uploadBody = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(uploadBody.get('uploadPath')).toBe('audios');

    const createBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(createBody).toMatchObject({
      input: {
        aspect_ratio: '16:9',
        duration: 8,
        generate_audio: false,
        reference_audio_urls: ['https://cdn.example.com/voice-drive.wav'],
        resolution: '720p',
        return_last_frame: false,
        web_search: false,
      },
      model: 'bytedance/seedance-2',
    });
    expect(createBody.input.prompt).toContain('Synchronize visible speech');
    expect(createBody.input).not.toHaveProperty('first_frame_url');
  });

  it('normalizes hosted Kie market task states and progress from recordInfo', async () => {
    const createTime = Date.UTC(2026, 4, 28, 12, 0, 0);
    const completeTime = Date.UTC(2026, 4, 28, 12, 6, 0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          createTime,
          progress: 35,
          state: 'generating',
          taskId: 'task_generating',
        },
        msg: 'success',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: {
          completeTime,
          failCode: '501',
          failMsg: 'Provider generation failed',
          state: 'fail ',
          taskId: 'task_failed',
        },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getHostedKlingTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, 'task_generating')).resolves.toMatchObject({
      createdAt: new Date(createTime).toISOString(),
      id: 'task_generating',
      progress: 0.35,
      status: 'processing',
    });

    await expect(getHostedKlingTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, 'task_failed')).resolves.toMatchObject({
      completedAt: new Date(completeTime).toISOString(),
      error: 'Provider generation failed',
      id: 'task_failed',
      status: 'failed',
    });
  });

  it('prices compact hosted chat models explicitly instead of falling through unknown-model defaults', () => {
    expect(getModelCreditCost('gpt-5.4-nano')).toBe(1);
    expect(getModelCreditCost('gpt-5.4-mini')).toBe(1);
    expect(getModelCreditCost('gpt-5.4')).toBe(5);
    expect(getModelCreditCost('gpt-5.5')).toBe(5);
  });

  it('keeps Cloud labels separate from BYO Kie.ai vendor credits', () => {
    expect(getFlashBoardPriceEstimate({
      duration: 10,
      outputType: 'video',
      providerId: 'kling-3.0',
      service: 'cloud',
    })?.compactLabel).toBe('840 cr');

    expect(getFlashBoardPriceEstimate({
      duration: 10,
      outputType: 'video',
      providerId: 'kling-3.0',
      service: 'kieai',
    })?.fullLabel).toBe('140 Kie credits');
  });
});
