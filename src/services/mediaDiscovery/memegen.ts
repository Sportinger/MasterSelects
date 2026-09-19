import type { MediaDiscoveryAsset } from './types';
import { templateSearchScore } from './templateSearch';
import { externalRequestSignal, plainExternalText, safeHttpsUrl } from './text';

const MEMEGEN_TEMPLATES_API = 'https://api.memegen.link/templates/';
const RESULT_LIMIT = 18;

interface MemegenTemplate {
  id?: string;
  name?: string;
  blank?: string;
  source?: string;
  keywords?: string[];
  _self?: string;
}

function imageMimeType(url: string): string | undefined {
  const extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'gif') return 'image/gif';
  if (extension === 'webp') return 'image/webp';
  return undefined;
}

export function parseMemegenTemplates(
  templates: MemegenTemplate[],
  query: string,
): MediaDiscoveryAsset[] {
  return templates
    .flatMap((template) => {
      const id = plainExternalText(template.id, 120);
      const title = plainExternalText(template.name, 240);
      const downloadUrl = safeHttpsUrl(template.blank);
      const sourcePageUrl = safeHttpsUrl(template._self);
      if (!id || !title || !downloadUrl || !sourcePageUrl) return [];
      const keywords = (template.keywords ?? [])
        .map((keyword) => plainExternalText(keyword, 160))
        .filter((keyword): keyword is string => Boolean(keyword));
      const score = templateSearchScore(query, [title, id, ...keywords]);
      if (score === undefined) return [];

      return [{
        score,
        asset: {
          id,
          provider: 'memegen' as const,
          providerLabel: 'Memegen.link',
          kind: 'image' as const,
          title,
          previewUrl: downloadUrl,
          downloadUrl,
          sourcePageUrl,
          contextUrl: safeHttpsUrl(template.source),
          licenseName: 'Rights not verified',
          attribution: 'Template supplied by Memegen.link.',
          rightsStatus: 'rights-unverified' as const,
          rightsNote: 'The generator is open source, but the underlying meme image may still be copyrighted.',
          mimeType: imageMimeType(downloadUrl),
        },
      }];
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, RESULT_LIMIT)
    .map(({ asset }) => asset);
}

export async function searchMemegenTemplates(
  query: string,
  signal?: AbortSignal,
): Promise<MediaDiscoveryAsset[]> {
  const response = await fetch(MEMEGEN_TEMPLATES_API, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    signal: externalRequestSignal(signal),
  });
  if (!response.ok) throw new Error(`Memegen search failed (${response.status}).`);
  return parseMemegenTemplates(await response.json() as MemegenTemplate[], query);
}
