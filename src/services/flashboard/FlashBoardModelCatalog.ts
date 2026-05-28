import { getVideoProviders } from '../piApiService';
import { getKieAiProviders } from '../kieAiService';
import {
  EVOLINK_NANO_BANANA_2_MODEL,
  EVOLINK_NANO_BANANA_2_PROVIDER_ID,
} from '../evolinkService';
import type { CatalogEntry } from './types';
import { DEFAULT_ELEVENLABS_MODEL_ID } from '../../stores/flashboardStore/defaults';
import { DEFAULT_SUNO_MODEL_ID, SUNO_MODEL_IDS, SUNO_PROVIDER_ID } from '../sunoService';

export function getCatalogEntries(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  for (const p of getVideoProviders()) {
    entries.push({
      service: 'piapi',
      providerId: p.id,
      name: p.name,
      description: p.description,
      versions: p.versions,
      modes: p.supportedModes,
      durations: p.supportedDurations,
      aspectRatios: p.supportedAspectRatios,
      supportsTextToVideo: p.supportsTextToVideo,
      supportsImageToVideo: p.supportsImageToVideo,
      supportsGenerateAudio: false,
      supportsMultiShot: false,
    });
  }

  for (const p of getKieAiProviders()) {
    const isImageOnly = !p.supportsTextToVideo && !p.supportsImageToVideo;
    const isSeedance2 = p.id === 'bytedance/seedance-2' || p.id === 'bytedance/seedance-2-fast';
    entries.push({
      service: 'kieai',
      providerId: p.id,
      name: `${p.name} (Kie.ai)`,
      description: p.description,
      versions: p.versions,
      modes: p.supportedModes,
      durations: p.supportedDurations,
      aspectRatios: p.supportedAspectRatios,
      supportsTextToVideo: p.supportsTextToVideo,
      supportsImageToVideo: p.supportsImageToVideo,
      supportsGenerateAudio: p.id === 'kling-3.0' || isSeedance2,
      supportsMultiShot: p.id === 'kling-3.0',
      maxReferenceMedia: p.id === 'kling-3.0' ? 3 : isSeedance2 ? 8 : undefined,
      ...(isImageOnly ? { supportsTextToImage: true, outputType: 'image' as const } : { outputType: 'video' as const }),
    });
  }

  entries.push({
    service: 'kieai',
    providerId: 'nano-banana-2',
    name: 'Nano Banana 2',
    description: 'Image generation via Kie.ai with up to 14 ordered reference images',
    versions: ['3.1'],
    modes: [],
    durations: [],
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    imageSizes: ['1K', '2K', '4K'],
    maxReferenceImages: 14,
    maxReferenceMedia: 14,
    outputType: 'image',
  });

  entries.push({
    service: 'evolink',
    providerId: EVOLINK_NANO_BANANA_2_PROVIDER_ID,
    name: 'Nano Banana 2 (EvoLink)',
    description: 'Image generation via EvoLink with up to 14 ordered reference images',
    versions: [EVOLINK_NANO_BANANA_2_MODEL],
    modes: [],
    durations: [],
    aspectRatios: ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    imageSizes: ['1K', '2K', '4K'],
    maxReferenceImages: 14,
    maxReferenceMedia: 14,
    outputType: 'image',
  });

  entries.push({
    service: 'elevenlabs',
    providerId: 'elevenlabs-tts',
    name: 'ElevenLabs',
    description: 'Text-to-speech voice generation',
    versions: [DEFAULT_ELEVENLABS_MODEL_ID],
    modes: [],
    durations: [],
    aspectRatios: [],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: false,
    supportsTextToAudio: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    outputType: 'audio',
  });

  entries.push({
    service: 'suno',
    providerId: SUNO_PROVIDER_ID,
    name: 'Suno',
    description: 'Text-to-music generation via Kie.ai Suno',
    versions: [DEFAULT_SUNO_MODEL_ID, ...SUNO_MODEL_IDS.filter((model) => model !== DEFAULT_SUNO_MODEL_ID)],
    modes: [],
    durations: [],
    aspectRatios: [],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: false,
    supportsTextToAudio: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    outputType: 'audio',
  });

  entries.push({
    service: 'cloud',
    providerId: 'cloud-elevenlabs-tts',
    name: 'ElevenLabs (Cloud)',
    description: 'Hosted text-to-speech generation via MasterSelects Cloud credits',
    versions: [DEFAULT_ELEVENLABS_MODEL_ID],
    modes: [],
    durations: [],
    aspectRatios: [],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: false,
    supportsTextToAudio: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    outputType: 'audio',
  });

  entries.push({
    service: 'cloud',
    providerId: SUNO_PROVIDER_ID,
    name: 'Suno (Cloud)',
    description: 'Hosted text-to-music generation via MasterSelects Cloud credits',
    versions: [DEFAULT_SUNO_MODEL_ID, ...SUNO_MODEL_IDS.filter((model) => model !== DEFAULT_SUNO_MODEL_ID)],
    modes: [],
    durations: [],
    aspectRatios: [],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: false,
    supportsTextToAudio: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    outputType: 'audio',
  });

  entries.push({
    service: 'cloud',
    providerId: 'cloud-kling',
    name: 'Kling (Cloud)',
    description: 'Hosted Kling via MasterSelects Cloud',
    versions: ['latest'],
    modes: ['std', 'pro'],
    durations: [5, 10],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsGenerateAudio: true,
    supportsMultiShot: true,
    maxReferenceMedia: 3,
    outputType: 'video',
  });

  entries.push({
    service: 'cloud',
    providerId: 'bytedance/seedance-2',
    name: 'Seedance 2.0 (Cloud)',
    description: 'Hosted Seedance 2.0 via MasterSelects Cloud',
    versions: ['latest'],
    modes: ['480p', '720p', '1080p'],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsGenerateAudio: true,
    supportsMultiShot: false,
    maxReferenceMedia: 8,
    outputType: 'video',
  });

  entries.push({
    service: 'cloud',
    providerId: 'bytedance/seedance-2-fast',
    name: 'Seedance 2.0 Fast (Cloud)',
    description: 'Hosted Seedance 2.0 Fast via MasterSelects Cloud',
    versions: ['latest'],
    modes: ['480p', '720p'],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsGenerateAudio: true,
    supportsMultiShot: false,
    maxReferenceMedia: 8,
    outputType: 'video',
  });

  entries.push({
    service: 'cloud',
    providerId: 'nano-banana-2',
    name: 'Nano Banana 2 (Cloud)',
    description: 'Hosted image generation via MasterSelects Cloud with up to 14 ordered reference images',
    versions: ['latest'],
    modes: [],
    durations: [],
    aspectRatios: ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
    supportsTextToVideo: false,
    supportsImageToVideo: false,
    supportsTextToImage: true,
    supportsGenerateAudio: false,
    supportsMultiShot: false,
    imageSizes: ['1K', '2K', '4K'],
    maxReferenceImages: 14,
    maxReferenceMedia: 14,
    outputType: 'image',
  });

  return entries;
}

export function getCatalogEntry(service: string, providerId: string): CatalogEntry | undefined {
  return getCatalogEntries().find(e => e.service === service && e.providerId === providerId);
}
