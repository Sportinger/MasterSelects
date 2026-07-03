import { afterEach, describe, expect, it, vi } from 'vitest';

import { calculateKieAiCost, getKieAiProviders, kieAiService } from '../../src/services/kieAiService';

describe('kieAiService', () => {
  afterEach(() => {
    kieAiService.setApiKey('');
    vi.unstubAllGlobals();
  });

  it('converts Kie.ai vendor credits to their USD value for balance display', async () => {
    kieAiService.setApiKey('kie_test_key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: 200 }), { status: 200 }),
    ));

    await expect(kieAiService.getAccountInfo()).resolves.toMatchObject({
      credits: 200,
      creditsUsd: 1,
    });
  });

  it('exposes Seedance 2.0 standard and fast Kie providers', () => {
    expect(getKieAiProviders()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'kling-3.0',
          supportedModes: ['std', 'pro', '4K'],
          supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          supportedAspectRatios: ['16:9', '9:16', '1:1'],
        }),
        expect.objectContaining({
          id: 'bytedance/seedance-2',
          supportedModes: ['480p', '720p', '1080p'],
          supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          supportedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        }),
        expect.objectContaining({
          id: 'bytedance/seedance-2-fast',
          supportedModes: ['480p', '720p'],
          supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          supportedAspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
        }),
      ]),
    );
  });

  it('uses explicit Kie.ai video vendor credit rates', () => {
    expect(calculateKieAiCost('kling-3.0', '4K', 10)).toBe(670);
    expect(calculateKieAiCost('bytedance/seedance-2', '480p', 10)).toBe(190);
    expect(calculateKieAiCost('bytedance/seedance-2', '720p', 10)).toBe(410);
    expect(calculateKieAiCost('bytedance/seedance-2', '1080p', 10)).toBe(1020);
    expect(calculateKieAiCost('bytedance/seedance-2', '720p', 10, false, { hasVideoInput: true })).toBe(250);
    expect(calculateKieAiCost('bytedance/seedance-2-fast', '480p', 10)).toBe(155);
    expect(calculateKieAiCost('bytedance/seedance-2-fast', '720p', 10, false, { hasVideoInput: true })).toBe(200);
  });

  it('sends Seedance 2.0 Fast tasks with Kie reference API fields', async () => {
    kieAiService.setApiKey('kie_test_key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            downloadUrl: 'https://example.com/download/motion',
            fileUrl: 'https://example.com/motion.mp4',
          },
          success: true,
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            downloadUrl: 'https://example.com/download/timing',
            fileUrl: 'https://example.com/timing.mp3',
          },
          success: true,
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_seedance_fast' } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kieAiService.createTextToVideo({
      provider: 'bytedance/seedance-2-fast',
      version: '2.0-fast',
      prompt: 'A cinematic robot crossing a neon street.',
      duration: 2,
      aspectRatio: '21:9',
      mode: '480p',
      sound: true,
      referenceMedia: [
        {
          mediaType: 'video',
          source: 'data:video/mp4;base64,AAAA',
          fileName: 'motion.mp4',
        },
        {
          mediaType: 'audio',
          source: 'data:audio/mpeg;base64,AAAA',
          fileName: 'timing.mp3',
        },
      ],
    })).resolves.toBe('task_seedance_fast');

    const request = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(request).toMatchObject({
      endpoint: '/api/v1/jobs/createTask',
      method: 'POST',
      body: {
        model: 'bytedance/seedance-2-fast',
        input: {
          aspect_ratio: '21:9',
          duration: 4,
          generate_audio: true,
          reference_video_urls: ['https://example.com/motion.mp4'],
          reference_audio_urls: ['https://example.com/timing.mp3'],
          resolution: '480p',
          return_last_frame: false,
          web_search: false,
        },
      },
    });
    expect(request.body.input).not.toHaveProperty('first_frame_url');
    expect(request.body.input).not.toHaveProperty('last_frame_url');
  });

  it('groups Kling image references into valid Kie element inputs', async () => {
    kieAiService.setApiKey('kie_test_key');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            downloadUrl: 'https://example.com/download/hero',
            fileUrl: 'https://example.com/hero.png',
          },
          success: true,
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            downloadUrl: 'https://example.com/download/hero-side',
            fileUrl: 'https://example.com/hero-side.png',
          },
          success: true,
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_kling' } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kieAiService.createTextToVideo({
      provider: 'kling-3.0',
      version: 'latest',
      prompt: 'A cinematic character enters the room.',
      duration: 5,
      aspectRatio: '16:9',
      mode: 'std',
      referenceMedia: [
        {
          mediaType: 'image',
          source: 'data:image/png;base64,AAAA',
          fileName: 'hero.png',
          label: 'Hero',
        },
        {
          mediaType: 'image',
          source: 'data:image/png;base64,BBBB',
          fileName: 'hero-side.png',
          label: 'Hero Side',
        },
      ],
    })).resolves.toBe('task_kling');

    const request = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(request).toMatchObject({
      endpoint: '/api/v1/jobs/createTask',
      method: 'POST',
      body: {
        model: 'kling-3.0/video',
        input: {
          kling_elements: [
            {
              description: 'Hero, Hero Side',
              element_input_urls: [
                'https://example.com/hero.png',
                'https://example.com/hero-side.png',
              ],
              name: 'ref_1',
            },
          ],
          prompt: 'A cinematic character enters the room. @ref_1',
        },
      },
    });
    expect(request.body.input.multi_shots).toBe(false);
  });

  it('sends Flux Kontext tasks to the dedicated Flux endpoint', async () => {
    kieAiService.setApiKey('kie_test_key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_flux' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kieAiService.createTextToImage({
      provider: 'flux-kontext-pro',
      prompt: 'Replace the background but preserve the subject.',
      aspectRatio: '16:9',
      imageInputs: ['https://cdn.example.com/source.png'],
    })).resolves.toBe('task_flux');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({
      endpoint: '/api/v1/flux/kontext/generate',
      method: 'POST',
      body: {
        prompt: 'Replace the background but preserve the subject.',
        inputImage: 'https://cdn.example.com/source.png',
        aspectRatio: '16:9',
        outputFormat: 'png',
        promptUpsampling: false,
        enableTranslation: true,
        safetyTolerance: 2,
        model: 'flux-kontext-pro',
      },
    });
  });

  it('sends Runway tasks to the dedicated Runway endpoint and downgrades 10s 1080p to 720p', async () => {
    kieAiService.setApiKey('kie_test_key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_runway' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kieAiService.createTextToVideo({
      provider: 'runway-video',
      version: 'latest',
      prompt: 'A handheld shot of a glass sculpture reflecting city lights.',
      duration: 10,
      aspectRatio: '16:9',
      mode: '1080p',
    })).resolves.toBe('task_runway');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({
      endpoint: '/api/v1/runway/generate',
      method: 'POST',
      body: {
        prompt: 'A handheld shot of a glass sculpture reflecting city lights.',
        duration: '10',
        quality: '720p',
        aspectRatio: '16:9',
        waterMark: '',
      },
    });
  });

  it('sends Topaz video upscale as a Market utility task with a video reference', async () => {
    kieAiService.setApiKey('kie_test_key');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task_topaz_video' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(kieAiService.createTextToVideo({
      provider: 'topaz/video-upscale',
      version: 'latest',
      prompt: '',
      duration: 5,
      aspectRatio: '16:9',
      mode: '4x',
      referenceMedia: [
        {
          mediaType: 'video',
          source: 'https://cdn.example.com/source.mp4',
          fileName: 'source.mp4',
        },
      ],
    })).resolves.toBe('task_topaz_video');

    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toMatchObject({
      endpoint: '/api/v1/jobs/createTask',
      method: 'POST',
      body: {
        model: 'topaz/video-upscale',
        input: {
          video_url: 'https://cdn.example.com/source.mp4',
          upscale_factor: '4',
        },
      },
    });
  });
});
