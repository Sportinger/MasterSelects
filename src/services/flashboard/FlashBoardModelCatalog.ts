import { getVideoProviders } from '../piApiService';
import { getKieAiProviders } from '../kieAiService';
import type { CatalogEntry } from './types';

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
      supportsGenerateAudio: p.id === 'kling-3.0',
      supportsMultiShot: p.id === 'kling-3.0',
      ...(isImageOnly ? { supportsTextToImage: true, outputType: 'image' as const } : { outputType: 'video' as const }),
    });
  }

  entries.push({
    service: 'kieai',
    providerId: 'nano-banana-2',
    name: 'Nano Banana 2',
    description: 'Image generation via Kie.ai',
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
    outputType: 'image',
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
    outputType: 'video',
  });

  return entries;
}

export function getCatalogEntry(service: string, providerId: string): CatalogEntry | undefined {
  return getCatalogEntries().find(e => e.service === service && e.providerId === providerId);
}
