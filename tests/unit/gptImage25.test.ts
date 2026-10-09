import { afterEach, describe, expect, it, vi } from 'vitest';
import { GPT_IMAGE_25_MODELS, getGptImage25ValidationError } from '../../src/services/kieAi/gptImage25';
import { getCatalogEntry } from '../../src/services/flashboard/FlashBoardModelCatalog';
import { getFlashBoardPriceEstimate } from '../../src/services/flashboard/FlashBoardPricing';
import { buildFlashBoardParameterOptions } from '../../src/components/panels/flashboard/FlashBoardParameterOptionsPlanner';
import { calculateHostedImageCost, createHostedImageTask } from '../../functions/lib/kieai';
import { normalizeHostedImageParams } from '../../functions/lib/providers/kieai';
import type { Env } from '../../functions/lib/env';

const env = { KIEAI_API_KEY: 'test-key' } as Env;
const provider = 'gpt-image-2-5-flare-text-to-image';
const base = { provider, prompt: 'A small green tree', aspectRatio: '1:1', resolution: '1K' };
afterEach(() => vi.unstubAllGlobals());

describe('GPT Image 2.5 hosted integration', () => {
  it.each(GPT_IMAGE_25_MODELS)('exposes and submits $id with the documented contract', async model => {
    const imageInputs = model.edit ? ['https://example.com/reference.png'] : [];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: { taskId: 'test-image' } })));
    vi.stubGlobal('fetch', fetchMock);
    const params = normalizeHostedImageParams({ ...base, provider: model.id, background: 'transparent', imageInputs, resolution: '2K' });
    expect(params).not.toBeNull();
    await expect(createHostedImageTask(env, params!)).resolves.toEqual({ taskId: 'test-image' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.kie.ai/api/v1/jobs/createTask');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: model.id,
      input: { prompt: base.prompt, aspect_ratio: '1:1', resolution: '2K', background: 'transparent', ...(model.edit ? { input_urls: imageInputs } : {}) },
    });
    const input = JSON.parse(fetchMock.mock.calls[0][1].body).input;
    expect(Object.keys(input).toSorted()).toEqual(['prompt', 'aspect_ratio', 'resolution', 'background', ...(model.edit ? ['input_urls'] : [])].toSorted());
    expect(getCatalogEntry('cloud', model.id)).toMatchObject({
      name: model.name, outputType: 'image', imageSizes: ['1K', '2K', '4K'],
      modes: ['auto', 'opaque', 'transparent'], maxReferenceImages: model.edit ? 16 : 0,
      requiresReferenceMedia: model.edit,
    });
    for (const [size, credits] of [['1K', 36], ['2K', 60], ['4K', 96]] as const) {
      expect(calculateHostedImageCost(model.id, size)).toBe(credits);
      expect(getFlashBoardPriceEstimate({ providerId: model.id, service: 'cloud', outputType: 'image', imageSize: size })?.compactLabel).toBe(`${credits} cr`);
    }
  });

  it.each([
    { prompt: '' }, { prompt: 'x'.repeat(20001) }, { resolution: '8K' },
    { aspectRatio: '27:16', resolution: '2K' }, { background: 'checkerboard' },
    { imageInputs: ['https://example.com/ref.png'] },
    { provider: 'gpt-image-2-5-flare-image-to-image', imageInputs: [] },
    { provider: 'gpt-image-2-5-sunburst-image-to-image', imageInputs: Array(17).fill('https://example.com/ref.png') },
  ])('rejects unsupported combinations before uploads or charging: %j', async overrides => {
    const params = { ...base, ...overrides };
    expect(getGptImage25ValidationError(params)).toBeTruthy();
    expect(normalizeHostedImageParams(params)).toBeNull();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(createHostedImageTask(env, params as Parameters<typeof createHostedImageTask>[1])).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts sixteen edit references and limits unusual ratios to 1K', () => {
    expect(getGptImage25ValidationError({ ...base, provider: 'gpt-image-2-5-flare-image-to-image', imageInputs: Array(16).fill('https://example.com/ref.png'), aspectRatio: '27:16' })).toBeNull();
    const options = { activePopover: 'aspect', aspectRatio: '1:1', duration: 5, effectiveGenerateAudio: false, hasVideoReferenceInput: false, imageSize: '2K', mode: 'auto', multiShots: false, providerId: provider, selectedEntry: getCatalogEntry('cloud', provider), service: 'cloud' as const };
    expect(buildFlashBoardParameterOptions(options).aspectOptions.map(o => o.id)).not.toContain('27:16');
    expect(buildFlashBoardParameterOptions({ ...options, imageSize: '1K' }).aspectOptions.map(o => o.id)).toContain('27:16');
    expect(buildFlashBoardParameterOptions({ ...options, activePopover: 'imageSize', aspectRatio: '27:16' }).imageSizeOptions.map(o => o.id)).toEqual(['1K']);
    expect(buildFlashBoardParameterOptions({ ...options, activePopover: 'imageSize' }).imageSizeOptions.map(o => o.id)).toEqual(['1K', '2K', '4K']);
  });
});
