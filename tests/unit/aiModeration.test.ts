import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringifyAiPayloadForStorage } from '../../functions/lib/aiAudit';
import {
  blocksAiRequest,
  buildModerationInput,
  clearImageModerationCache,
  collectModerationImages,
  MAX_MODERATED_IMAGES,
  moderateAiInput,
  type AiModerationResult,
} from '../../functions/lib/aiModeration';
import type { Env } from '../../functions/lib/env';

function moderation(
  status: AiModerationResult['status'],
  flagged = false,
  categories: string[] = flagged ? ['illicit'] : [],
): AiModerationResult {
  return {
    categories,
    errorMessage: null,
    flagged,
    payload: null,
    status,
  };
}

describe('hosted AI moderation helpers', () => {
  it('extracts prompt text from nested request payloads', () => {
    expect(buildModerationInput({
      prompt: 'make a clip',
      referenceMedia: [{ label: 'REF 1', source: 'https://example.test/a.png' }],
    })).toBe('make a clip');

    expect(buildModerationInput([{ text: 'first' }, { prompt: 'second' }])).toBe('first\nsecond');
  });

  it('keeps captured image bytes out of moderation text and stored logs', () => {
    const input = {
      content: [
        { type: 'text', text: 'describe the frame' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      ],
    };

    expect(buildModerationInput(input)).toContain('describe the frame');
    expect(buildModerationInput(input)).not.toContain('AAAA');
    expect(stringifyAiPayloadForStorage(input)).toContain('[image data omitted]');
    expect(stringifyAiPayloadForStorage(input)).not.toContain('AAAA');
  });

  it('blocks flagged and failed moderation results', () => {
    expect(blocksAiRequest(moderation('clean'))).toBe(false);
    expect(blocksAiRequest(moderation('flagged', true))).toBe(true);
    expect(blocksAiRequest(moderation('error'))).toBe(true);
  });

  it('can allow a specific non-graphic category without allowing mixed or unknown flags', () => {
    const videoOptions = { allowedFlaggedCategories: ['violence'] };

    expect(blocksAiRequest(moderation('flagged', true, ['violence']), videoOptions)).toBe(false);
    expect(blocksAiRequest(
      moderation('flagged', true, ['violence', 'violence/graphic']),
      videoOptions,
    )).toBe(true);
    expect(blocksAiRequest(
      moderation('flagged', true, ['violence', 'illicit/violent']),
      videoOptions,
    )).toBe(true);
    expect(blocksAiRequest(moderation('flagged', true, []), videoOptions)).toBe(true);
  });

  it('collects frames from chat, Claude base64 sources and generation references', () => {
    expect(collectModerationImages({
      messages: [
        { content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
        { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } }] },
        { content: [{ type: 'input_image', image_url: 'data:image/webp;base64,CCCC' }] },
      ],
    })).toEqual([
      'data:image/jpeg;base64,AAAA',
      'data:image/png;base64,BBBB',
      'data:image/webp;base64,CCCC',
    ]);

    expect(collectModerationImages({
      endImageUrl: 'https://example.test/end.png',
      prompt: 'see https://example.test/not-an-image-field',
      referenceMedia: [
        { mediaType: 'image', source: 'https://example.test/ref.png' },
        { mediaType: 'video', source: 'https://example.test/ref.mp4' },
        { mediaType: 'video', source: 'data:video/mp4;base64,DDDD' },
      ],
      startImageUrl: 'data:image/png;base64,EEEE',
    })).toEqual([
      'https://example.test/end.png',
      'https://example.test/ref.png',
      'data:image/png;base64,EEEE',
    ]);
  });

  it('keeps base64 bytes of any media type out of moderation text', () => {
    const text = buildModerationInput({
      messages: [{ content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } },
        'data:video/mp4;base64,DDDD',
        { type: 'text', text: 'cut this' },
      ] }],
    });

    expect(text).toContain('cut this');
    expect(text).not.toContain('BBBB');
    expect(text).not.toContain('DDDD');
  });

  it('checks only the newest unique images', () => {
    const urls = Array.from({ length: MAX_MODERATED_IMAGES + 3 }, (_, index) => `data:image/png;base64,F${index}`);
    const images = collectModerationImages({ messages: [...urls, urls[0]] });

    expect(images).toHaveLength(MAX_MODERATED_IMAGES);
    expect(images.at(-1)).toBe(urls.at(-1));
  });
});

describe('hosted AI image moderation', () => {
  const env = { OPENAI_API_KEY: 'test-key' } as unknown as Env;

  afterEach(() => {
    vi.unstubAllGlobals();
    clearImageModerationCache();
  });

  function stubModeration(verdicts: Record<string, string[] | 'fail'>) {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: unknown };
      const key = typeof body.input === 'string'
        ? 'text'
        : (body.input as Array<{ image_url: { url: string } }>)[0].image_url.url;
      const verdict = verdicts[key] ?? [];
      if (verdict === 'fail') {
        return new Response(JSON.stringify({ error: { message: 'upstream down' } }), { status: 500 });
      }
      return new Response(JSON.stringify({
        results: [{
          categories: Object.fromEntries(verdict.map((category) => [category, true])),
          flagged: verdict.length > 0,
        }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const frame = 'data:image/jpeg;base64,AAAA';
  const request = { messages: [{ content: [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: frame } }] }] };

  it('blocks sexual or graphic images and checks text separately', async () => {
    const fetchMock = stubModeration({ [frame]: ['sexual'] });
    const result = await moderateAiInput(env, request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ categories: ['image:sexual'], flagged: true, status: 'flagged' });
    expect(blocksAiRequest(result, { allowedFlaggedCategories: ['violence'] })).toBe(true);
  });

  it('allows images flagged only for non-blocking categories', async () => {
    stubModeration({ [frame]: ['violence'] });
    const result = await moderateAiInput(env, request);

    expect(result).toMatchObject({ categories: [], flagged: false, status: 'clean' });
    expect(blocksAiRequest(result)).toBe(false);
  });

  it('moderates image-only payloads and fails closed when an image check fails', async () => {
    stubModeration({ [frame]: 'fail' });
    const result = await moderateAiInput(env, { startImageUrl: frame });

    expect(result).toMatchObject({ errorMessage: 'upstream down', status: 'error' });
    expect(blocksAiRequest(result)).toBe(true);
  });

  it('reuses verdicts for frames resent by later chat turns', async () => {
    const fetchMock = stubModeration({ [frame]: ['sexual'] });

    const first = await moderateAiInput(env, request);
    const second = await moderateAiInput(env, request);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(second.categories).toEqual(first.categories);
    expect(blocksAiRequest(second)).toBe(true);
  });

  it('does not cache failed checks or http images', async () => {
    const httpImage = 'https://example.test/start.png';
    const imageCalls = (mock: ReturnType<typeof stubModeration>, url: string) => mock.mock.calls
      .filter(([, init]) => String(init.body).includes('image_url') && String(init.body).includes(url)).length;

    stubModeration({ [frame]: 'fail' });
    await moderateAiInput(env, { startImageUrl: frame });
    const fetchMock = stubModeration({});
    await moderateAiInput(env, { startImageUrl: frame });
    await moderateAiInput(env, { imageInputs: [httpImage] });
    await moderateAiInput(env, { imageInputs: [httpImage] });

    expect(imageCalls(fetchMock, frame)).toBe(1);
    expect(imageCalls(fetchMock, httpImage)).toBe(2);
  });
});
