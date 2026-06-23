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
    const providerIds = entries
      .filter((candidate) => candidate.service === 'kieai' && candidate.outputType === 'image')
      .map((candidate) => candidate.providerId);

    expect(providerIds).toEqual(expect.arrayContaining([
      'nano-banana-2',
      'nano-banana-pro',
      'google/imagen4-fast',
      'google/imagen4-ultra',
      'gpt-image-2-text-to-image',
      'gpt-image-2-image-to-image',
      'flux-2/pro-text-to-image',
      'flux-2/pro-image-to-image',
      'seedream/5-lite-text-to-image',
      'seedream/5-lite-image-to-image',
    ]));

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
      versions: ['V5', 'V4_5PLUS', 'V4_5', 'V4'],
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
