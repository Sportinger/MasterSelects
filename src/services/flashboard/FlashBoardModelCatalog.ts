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
      ...(isImageOnly ? { supportsTextToImage: true } : {}),
    });
  }

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
  });

  return entries;
}

export function getCatalogEntry(service: string, providerId: string): CatalogEntry | undefined {
  return getCatalogEntries().find(e => e.service === service && e.providerId === providerId);
}
