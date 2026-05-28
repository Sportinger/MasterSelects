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

  it('uses explicit Kie.ai Seedance 2.0 vendor credit rates', () => {
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
          generate_audio: false,
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
});
