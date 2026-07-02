import { describe, expect, it } from 'vitest';

import { getCatalogEntries } from '../../src/services/flashboard/FlashBoardModelCatalog';
import { getFlashBoardPriceEstimate } from '../../src/services/flashboard/FlashBoardPricing';
import {
  EVOLINK_NANO_BANANA_2_MODEL,
  EVOLINK_NANO_BANANA_2_PROVIDER_ID,
} from '../../src/services/evolinkService';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  createDefaultFlashBoardComposer,
} from '../../src/stores/flashboardStore/defaults';

describe('FlashBoard audio catalog contract', () => {
  it('exposes EvoLink Nano Banana 2 as an image provider', () => {
    const entry = getCatalogEntries().find((candidate) => candidate.providerId === EVOLINK_NANO_BANANA_2_PROVIDER_ID);

    expect(entry).toMatchObject({
      service: 'evolink',
      providerId: EVOLINK_NANO_BANANA_2_PROVIDER_ID,
      outputType: 'image',
      supportsTextToImage: true,
      supportsTextToVideo: false,
      supportsImageToVideo: false,
      versions: [EVOLINK_NANO_BANANA_2_MODEL],
      maxReferenceImages: 14,
    });
  });

  it('does not invent a local EvoLink cost estimate when provider pricing is credit-account based', () => {
    expect(
      getFlashBoardPriceEstimate({
        providerId: EVOLINK_NANO_BANANA_2_PROVIDER_ID,
        service: 'evolink',
        outputType: 'image',
        imageSize: '2K',
      }),
    ).toBeNull();
  });

  it('exposes ElevenLabs as an audio generation provider', () => {
    const entry = getCatalogEntries().find((candidate) => candidate.providerId === 'elevenlabs-tts');

    expect(entry).toMatchObject({
      service: 'elevenlabs',
      providerId: 'elevenlabs-tts',
      outputType: 'audio',
      supportsTextToAudio: true,
      supportsTextToVideo: false,
      supportsImageToVideo: false,
      supportsTextToImage: false,
      versions: [DEFAULT_ELEVENLABS_MODEL_ID],
    });
  });

  it('does not estimate Kie or hosted credits for ElevenLabs audio', () => {
    expect(
      getFlashBoardPriceEstimate({
        providerId: 'elevenlabs-tts',
        service: 'elevenlabs',
        outputType: 'audio',
      }),
    ).toBeNull();
  });

  it('exposes Kie.ai Seedance 2.0 Fast as a video provider with current Kie credit estimates', () => {
    const entry = getCatalogEntries().find((candidate) => candidate.providerId === 'bytedance/seedance-2-fast');
    const cloudEntry = getCatalogEntries().find((candidate) => (
      candidate.service === 'cloud' && candidate.providerId === 'bytedance/seedance-2-fast'
    ));

    expect(entry).toMatchObject({
      service: 'kieai',
      providerId: 'bytedance/seedance-2-fast',
      outputType: 'video',
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      supportsGenerateAudio: true,
      modes: ['480p', '720p'],
      maxReferenceMedia: 8,
    });
    expect(cloudEntry).toMatchObject({
      service: 'cloud',
      providerId: 'bytedance/seedance-2-fast',
      outputType: 'video',
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      supportsGenerateAudio: true,
      modes: ['480p', '720p'],
    });

    expect(
      getFlashBoardPriceEstimate({
        duration: 10,
        mode: '720p',
        outputType: 'video',
        providerId: 'bytedance/seedance-2-fast',
        service: 'kieai',
      })?.fullLabel,
    ).toBe('330 Kie credits');

    expect(
      getFlashBoardPriceEstimate({
        duration: 10,
        hasVideoInput: true,
        mode: '720p',
        outputType: 'video',
        providerId: 'bytedance/seedance-2-fast',
        service: 'kieai',
      })?.fullLabel,
    ).toBe('200 Kie credits');
  });

  it('exposes current Kie.ai image generation and edit models', () => {
    const entries = getCatalogEntries();
    const findImageEntry = (providerId: string) => entries.find((candidate) => (
      candidate.service === 'kieai' && candidate.providerId === providerId
    ));
    const providerIds = entries
      .filter((candidate) => candidate.service === 'kieai' && candidate.outputType === 'image')
      .map((candidate) => candidate.providerId);

    expect(providerIds).toEqual(expect.arrayContaining([
      'nano-banana-2',
      'nano-banana-pro',
      'gpt-image-2-text-to-image',
      'gpt-image-2-image-to-image',
      'flux-2/pro-text-to-image',
      'flux-2/pro-image-to-image',
      'seedream/5-lite-text-to-image',
      'seedream/5-lite-image-to-image',
      'flux-kontext-pro',
      'flux-kontext-max',
      'recraft/remove-background',
      'recraft/crisp-upscale',
      'topaz/image-upscale',
    ]));
    expect(providerIds).not.toEqual(expect.arrayContaining([
      'google/imagen4-fast',
      'google/imagen4-ultra',
    ]));

    expect(findImageEntry('gpt-image-2-text-to-image')?.aspectRatios).toEqual([
      'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16',
      '2:1', '1:2', '3:1', '1:3', '21:9', '9:21', '5:4', '4:5',
    ]);
    expect(findImageEntry('gpt-image-2-image-to-image')?.aspectRatios).toEqual([
      'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16',
      '2:1', '1:2', '3:1', '1:3', '21:9', '9:21', '5:4', '4:5',
    ]);
    expect(findImageEntry('flux-2/pro-text-to-image')?.aspectRatios).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
    expect(findImageEntry('flux-2/pro-image-to-image')?.aspectRatios).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', 'auto']);
    expect(findImageEntry('seedream/5-lite-text-to-image')?.aspectRatios).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']);
    expect(findImageEntry('seedream/5-lite-image-to-image')?.aspectRatios).toEqual(['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']);
    expect(findImageEntry('flux-kontext-pro')?.aspectRatios).toEqual(['16:9', '21:9', '4:3', '1:1', '3:4', '9:16', '16:21']);
    expect(findImageEntry('flux-kontext-max')?.aspectRatios).toEqual(['16:9', '21:9', '4:3', '1:1', '3:4', '9:16', '16:21']);

    expect(entries.find((candidate) => candidate.providerId === 'gpt-image-2-image-to-image')).toMatchObject({
      requiresReferenceMedia: true,
      promptRefinerProfile: 'gpt-image-edit',
      maxReferenceMedia: 16,
    });
    expect(entries.find((candidate) => candidate.providerId === 'flux-2/pro-image-to-image')).toMatchObject({
      requiresReferenceMedia: true,
      promptRefinerProfile: 'flux-edit',
      maxReferenceMedia: 8,
    });
    expect(entries.find((candidate) => candidate.providerId === 'recraft/remove-background')).toMatchObject({
      requiresPrompt: false,
      requiresReferenceMedia: true,
      requiredReferenceMediaType: 'image',
      promptRefinerProfile: 'utility-image',
    });
    expect(entries.find((candidate) => candidate.providerId === 'topaz/image-upscale')).toMatchObject({
      imageSizes: ['2x', '4x'],
      requiresPrompt: false,
      requiredReferenceMediaType: 'image',
    });
  });

  it('exposes current Kie.ai video utilities and premium video providers', () => {
    const entries = getCatalogEntries();

    expect(entries.find((candidate) => (
      candidate.service === 'kieai' && candidate.providerId === 'kling-3.0'
    ))).toMatchObject({
      outputType: 'video',
      modes: ['std', 'pro', '4K'],
      modeLabels: { std: '720p', pro: '1080p', '4K': '4K' },
      modeControlLabel: 'Resolution',
      referenceInputKinds: ['start-frame', 'end-frame', 'image-reference', 'video-reference'],
      maxReferenceMedia: 3,
    });
    expect(entries.find((candidate) => (
      candidate.service === 'cloud' && candidate.providerId === 'cloud-kling'
    ))).toMatchObject({
      modes: ['std', 'pro', '4K'],
      modeLabels: { std: '720p', pro: '1080p', '4K': '4K' },
      referenceInputKinds: ['start-frame', 'end-frame', 'image-reference', 'video-reference'],
    });
    expect(entries.find((candidate) => candidate.providerId === 'veo-3.1')).toMatchObject({
      service: 'kieai',
      outputType: 'video',
      supportsTextToVideo: true,
      supportsImageToVideo: true,
      modes: ['veo3_fast', 'veo3', 'veo3_lite'],
      modeLabels: { veo3_fast: 'Fast', veo3: 'Quality', veo3_lite: 'Lite' },
      referenceInputKinds: ['start-frame', 'end-frame', 'image-reference'],
      maxReferenceMedia: 3,
      promptRefinerProfile: 'veo',
    });
    expect(entries.find((candidate) => candidate.providerId === 'runway-video')).toMatchObject({
      service: 'kieai',
      outputType: 'video',
      durations: [5, 10],
      modes: ['720p', '1080p'],
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      referenceInputKinds: ['start-frame', 'image-reference'],
      maxReferenceMedia: 1,
      promptRefinerProfile: 'runway',
    });
    expect(entries.find((candidate) => (
      candidate.service === 'cloud' && candidate.providerId === 'runway-video'
    ))).toMatchObject({
      aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    });
    expect(entries.find((candidate) => candidate.providerId === 'topaz/video-upscale')).toMatchObject({
      service: 'kieai',
      outputType: 'video',
      modes: ['2x', '4x'],
      requiresPrompt: false,
      requiresReferenceMedia: true,
      requiredReferenceMediaType: 'video',
      promptRefinerProfile: 'utility-video',
    });
  });

  it('exposes Suno Sounds separately from Suno Music', () => {
    const entry = getCatalogEntries().find((candidate) => (
      candidate.service === 'suno' && candidate.providerId === 'suno-sounds'
    ));

    expect(entry).toMatchObject({
      service: 'suno',
      providerId: 'suno-sounds',
      outputType: 'audio',
      supportsTextToAudio: true,
      modes: ['one-shot', 'loop'],
      promptRefinerProfile: 'suno-sounds',
    });
  });

  it('exposes hosted Suno music as a Cloud audio provider', () => {
    const entry = getCatalogEntries().find((candidate) => (
      candidate.service === 'cloud' && candidate.providerId === 'suno-music'
    ));

    expect(entry).toMatchObject({
      service: 'cloud',
      providerId: 'suno-music',
      outputType: 'audio',
      supportsTextToAudio: true,
      supportsTextToVideo: false,
      supportsImageToVideo: false,
      supportsTextToImage: false,
      versions: ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4'],
    });
  });

  it('creates default audio composer settings for every reset path', () => {
    expect(createDefaultFlashBoardComposer()).toMatchObject({
      languageOverride: false,
      outputFormat: DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
      voiceSettings: DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    });
  });
});
