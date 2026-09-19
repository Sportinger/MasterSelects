import type { MediaDiscoveryAsset } from './types';
import { templateSearchScore } from './templateSearch';
import { externalRequestSignal, plainExternalText, safeHttpsUrl } from './text';

const IMGFLIP_TEMPLATES_API = 'https://api.imgflip.com/get_memes?type=image';
const RESULT_LIMIT = 18;

interface ImgflipTemplate {
  id?: string;
  name?: string;
  url?: string;
  width?: number;
  height?: number;
  captions?: number;
}

interface ImgflipResponse {
  success?: boolean;
  error_message?: string;
  data?: { memes?: ImgflipTemplate[] };
}

export function parseImgflipTemplates(
  templates: ImgflipTemplate[],
  query: string,
): MediaDiscoveryAsset[] {
  return templates
    .flatMap((template) => {
      const id = plainExternalText(template.id, 120);
      const title = plainExternalText(template.name, 240);
      const downloadUrl = safeHttpsUrl(template.url);
      if (!id || !title || !downloadUrl) return [];
      const score = templateSearchScore(query, [title]);
      if (score === undefined) return [];

      return [{
        score,
        asset: {
          id,
          provider: 'imgflip' as const,
          providerLabel: 'Imgflip',
          kind: 'image' as const,
          title,
          previewUrl: downloadUrl,
          downloadUrl,
          sourcePageUrl: `https://imgflip.com/memetemplate/${encodeURIComponent(id)}`,
          creator: 'Imgflip community',
          licenseName: 'Rights not verified',
          attribution: 'User-uploaded template supplied by Imgflip.',
          rightsStatus: 'rights-unverified' as const,
          rightsNote: 'Imgflip does not verify that every uploaded template is authorized for reuse.',
          mimeType: 'image/jpeg',
          width: template.width,
          height: template.height,
        },
      }];
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, RESULT_LIMIT)
    .map(({ asset }) => asset);
}

export async function searchImgflipTemplates(
  query: string,
  signal?: AbortSignal,
): Promise<MediaDiscoveryAsset[]> {
  const response = await fetch(IMGFLIP_TEMPLATES_API, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    signal: externalRequestSignal(signal),
  });
  if (!response.ok) throw new Error(`Imgflip search failed (${response.status}).`);
  const payload = await response.json() as ImgflipResponse;
  if (!payload.success) throw new Error(payload.error_message || 'Imgflip search failed.');
  return parseImgflipTemplates(payload.data?.memes ?? [], query);
}
