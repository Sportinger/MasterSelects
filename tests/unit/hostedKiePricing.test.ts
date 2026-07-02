import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  calculateHostedImageCost,
  calculateHostedKlingCost,
  calculateHostedSeedanceCost,
  calculateHostedSunoCost,
  createHostedImageTask,
  createHostedKlingTask,
  createHostedSeedanceTask,
  createHostedSunoSoundsTask,
  getHostedKlingTask,
} from '../../functions/lib/kieai';
import { normalizeHostedImageParams, normalizeHostedKlingParams } from '../../functions/lib/providers/kieai';
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
    expect(calculateHostedKlingCost('4K', 10, false)).toBe(4020);
  });

  it('charges hosted Nano Banana 2 image generation at the 6x cloud multiplier', () => {
    expect(calculateHostedImageCost('nano-banana-2', '1K')).toBe(48);
    expect(calculateHostedImageCost('nano-banana-2', '2K')).toBe(72);
    expect(calculateHostedImageCost('nano-banana-2', '4K')).toBe(108);
  });

  it('rejects currently failing hosted Imagen providers at the route boundary', () => {
    expect(normalizeHostedImageParams({
      aspectRatio: '16:9',
      outputType: 'image',
      prompt: 'tree',
      provider: 'google/imagen4-fast',
      resolution: '1K',
    })).toBeNull();
  });

  it('uses hosted image edit provider input keys', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/source',
          fileUrl: 'https://cdn.example.com/source.png',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'gpt_image_edit_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedImageTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      aspectRatio: 'auto',
      imageInputs: ['data:image/png;base64,AAAA'],
      prompt: 'Keep the subject and replace the background.',
      provider: 'gpt-image-2-image-to-image',
      resolution: '1K',
    })).resolves.toEqual({ taskId: 'gpt_image_edit_task_1' });

    const createBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(createBody.input).toEqual({
      aspect_ratio: 'auto',
      input_urls: ['https://cdn.example.com/source.png'],
      prompt: 'Keep the subject and replace the background.',
    });
  });

  it('normalizes hosted Kling reference media for production cloud requests', () => {
    expect(normalizeHostedKlingParams({
      duration: 5,
      mode: '4K',
      prompt: 'Make REF 1 walk through the frame.',
      provider: 'cloud-kling',
      referenceMedia: [
        {
          fileName: 'hero.png',
          label: 'Hero',
          mediaType: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,AAAA',
        },
      ],
    })).toMatchObject({
      mode: '4K',
      provider: 'kling-3.0',
      referenceMedia: [
        {
          fileName: 'hero.png',
          label: 'Hero',
          mediaType: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,AAAA',
        },
      ],
    });
  });

  it('uploads hosted Kling reference media into Kie.ai kling_elements', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/hero',
          fileUrl: 'https://cdn.example.com/hero.png',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/hero-side',
          fileUrl: 'https://cdn.example.com/hero-side.png',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/motion',
          fileUrl: 'https://cdn.example.com/motion.mp4',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'kling_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedKlingTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      aspectRatio: '16:9',
      duration: 5,
      mode: 'pro',
      prompt: 'A cinematic subject enters the frame.',
      provider: 'kling-3.0',
      referenceMedia: [
        {
          fileName: 'hero.png',
          label: 'Hero',
          mediaType: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,AAAA',
        },
        {
          fileName: 'hero-side.png',
          label: 'Hero Side',
          mediaType: 'image',
          mimeType: 'image/png',
          source: 'data:image/png;base64,BBBB',
        },
        {
          fileName: 'motion.mp4',
          label: 'Motion',
          mediaType: 'video',
          mimeType: 'video/mp4',
          source: 'data:video/mp4;base64,AAAA',
        },
      ],
      sound: false,
    })).resolves.toEqual({ taskId: 'kling_task_1' });

    const firstUploadBody = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const secondUploadBody = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    const thirdUploadBody = fetchMock.mock.calls[2]?.[1]?.body as FormData;
    expect(firstUploadBody.get('uploadPath')).toBe('images');
    expect(secondUploadBody.get('uploadPath')).toBe('images');
    expect(thirdUploadBody.get('uploadPath')).toBe('videos');

    const createBody = JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string);
    expect(createBody).toMatchObject({
      input: {
        aspect_ratio: '16:9',
        duration: '5',
        kling_elements: [
          {
            description: 'Hero, Hero Side',
            element_input_urls: [
              'https://cdn.example.com/hero.png',
              'https://cdn.example.com/hero-side.png',
            ],
            name: 'ref_1',
          },
          {
            description: 'Motion',
            element_input_urls: ['https://cdn.example.com/motion.mp4'],
            name: 'ref_2',
          },
        ],
        mode: 'pro',
        prompt: 'A cinematic subject enters the frame. @ref_1 @ref_2',
        sound: false,
      },
      model: 'kling-3.0/video',
    });
    expect(createBody.input.multi_shots).toBe(false);
  });

  it('charges hosted Suno music generation through MasterSelects Cloud credits', () => {
    expect(calculateHostedSunoCost()).toBe(72);
    expect(getFlashBoardPriceEstimate({
      outputType: 'audio',
      providerId: 'suno-music',
      service: 'cloud',
    })?.compactLabel).toBe('72 cr');
  });

  it('charges hosted Suno Sounds generation through the same Cloud Kie.ai route family', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'sounds_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedSunoSoundsTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      model: 'V5',
      prompt: 'Clean sci-fi door servo, short pneumatic release.',
      soundLoop: true,
    })).resolves.toEqual({ taskId: 'sounds_task_1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.kie.ai/api/v1/generate/sounds');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      grabLyrics: false,
      model: 'V5',
      prompt: 'Clean sci-fi door servo, short pneumatic release.',
      soundLoop: true,
    });
    expect(getFlashBoardPriceEstimate({
      outputType: 'audio',
      providerId: 'suno-sounds',
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
        generate_audio: true,
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

  it('routes hosted Flux Kontext image generation through Kie.ai special endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          downloadUrl: 'https://cdn.example.com/download/source',
          fileUrl: 'https://cdn.example.com/source.png',
        },
        success: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'flux_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedImageTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      aspectRatio: '1:1',
      imageInputs: ['data:image/png;base64,AAAA'],
      prompt: 'Replace the product color with brushed steel.',
      provider: 'flux-kontext-pro',
      resolution: '1K',
    })).resolves.toEqual({ taskId: 'flux:flux_task_1' });

    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.kie.ai/api/v1/flux/kontext/generate');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      aspectRatio: '1:1',
      inputImage: 'https://cdn.example.com/source.png',
      model: 'flux-kontext-pro',
      prompt: 'Replace the product color with brushed steel.',
    });
  });

  it('routes hosted Runway video generation through Kie.ai special endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 200,
        data: { taskId: 'runway_task_1' },
        msg: 'success',
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createHostedKlingTask({
      KIEAI_API_KEY: 'kie_test_key',
    } as Partial<Env> as Env, {
      aspectRatio: '16:9',
      duration: 10,
      mode: '1080p',
      prompt: 'A controlled cinematic product dolly shot.',
      provider: 'runway-video',
      sound: false,
    })).resolves.toEqual({ taskId: 'runway:runway_task_1' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.kie.ai/api/v1/runway/generate');
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      aspectRatio: '16:9',
      duration: '10',
      prompt: 'A controlled cinematic product dolly shot.',
      quality: '720p',
      waterMark: '',
    });
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
