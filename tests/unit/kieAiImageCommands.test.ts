import { describe, expect, it } from 'vitest';

import { buildKieAiImageTaskInput } from '../../src/services/kieAi/imageCommands';

describe('Kie.ai image command payloads', () => {
  it('uses Nano Banana 2 image_input with generation options', () => {
    expect(buildKieAiImageTaskInput({
      provider: 'nano-banana-2',
      prompt: 'make a poster',
      aspectRatio: '16:9',
      resolution: '2K',
      outputFormat: 'jpeg',
    }, ['https://cdn.example.com/ref.png'])).toEqual({
      prompt: 'make a poster',
      aspect_ratio: '16:9',
      image_input: ['https://cdn.example.com/ref.png'],
      resolution: '2K',
      output_format: 'jpeg',
      google_search: false,
    });
  });

  it('uses GPT Image 2 input_urls for image-to-image', () => {
    expect(buildKieAiImageTaskInput({
      provider: 'gpt-image-2-image-to-image',
      prompt: 'change only the jacket',
      aspectRatio: 'auto',
    }, ['https://cdn.example.com/ref.png'])).toEqual({
      prompt: 'change only the jacket',
      aspect_ratio: 'auto',
      input_urls: ['https://cdn.example.com/ref.png'],
    });
  });

  it('uses Seedream image_urls and quality for image-to-image', () => {
    expect(buildKieAiImageTaskInput({
      provider: 'seedream/5-lite-image-to-image',
      prompt: 'preserve pose, change material',
      aspectRatio: '1:1',
    }, ['https://cdn.example.com/ref.webp'])).toEqual({
      prompt: 'preserve pose, change material',
      aspect_ratio: '1:1',
      image_urls: ['https://cdn.example.com/ref.webp'],
      quality: 'basic',
      nsfw_checker: false,
    });
  });

  it('rejects image-to-image models without references', () => {
    expect(() => buildKieAiImageTaskInput({
      provider: 'flux-2/pro-image-to-image',
      prompt: 'edit the object',
    })).toThrow('Add at least one reference image');
  });
});
