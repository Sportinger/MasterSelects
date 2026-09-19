import type {
  MediaDiscoveryAsset,
  MediaDiscoveryContentFilter,
  MediaDiscoveryKind,
} from './types';
import { externalRequestSignal, plainExternalText, safeHttpsUrl } from './text';

const OPENVERSE_API = 'https://api.openverse.org/v1';
const OPENVERSE_LICENSES = 'cc0,pdm,by,by-sa';

interface OpenverseResult {
  id?: string;
  title?: string;
  creator?: string;
  creator_url?: string;
  url?: string;
  thumbnail?: string;
  waveform?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  attribution?: string;
  filetype?: string;
  filesize?: number;
  width?: number;
  height?: number;
  duration?: number;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  flac: 'audio/flac',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  png: 'image/png',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  webp: 'image/webp',
};

function licenseLabel(code: string, version?: string): string {
  const suffix = version ? ` ${version}` : '';
  switch (code.toLowerCase()) {
    case 'cc0': return `CC0${suffix}`;
    case 'pdm': return 'Public Domain Mark';
    case 'by': return `CC BY${suffix}`;
    case 'by-sa': return `CC BY-SA${suffix}`;
    default: return code.toUpperCase();
  }
}

export function parseOpenverseResults(
  results: OpenverseResult[],
  kind: Exclude<MediaDiscoveryKind, 'video'>,
): MediaDiscoveryAsset[] {
  return results.flatMap((result) => {
    const id = plainExternalText(result.id, 160);
    const title = plainExternalText(result.title, 240) ?? 'Untitled';
    const downloadUrl = safeHttpsUrl(result.url);
    const sourcePageUrl = safeHttpsUrl(result.foreign_landing_url);
    const licenseCode = plainExternalText(result.license, 40);
    if (!id || !downloadUrl || !sourcePageUrl || !licenseCode) return [];
    const filetype = plainExternalText(result.filetype, 20)?.toLowerCase();

    return [{
      id,
      provider: 'openverse' as const,
      providerLabel: 'Openverse',
      kind,
      title,
      previewUrl: safeHttpsUrl(kind === 'audio' ? result.waveform : result.thumbnail),
      downloadUrl,
      sourcePageUrl,
      creator: plainExternalText(result.creator, 500),
      creatorUrl: safeHttpsUrl(result.creator_url),
      licenseName: licenseLabel(licenseCode, plainExternalText(result.license_version, 20)),
      licenseUrl: safeHttpsUrl(result.license_url),
      attribution: plainExternalText(result.attribution, 1_000),
      rightsStatus: 'open-license',
      mimeType: filetype ? MIME_BY_EXTENSION[filetype] : undefined,
      fileSize: result.filesize,
      width: result.width,
      height: result.height,
      durationMs: result.duration,
    }];
  });
}

export async function searchOpenverse(
  query: string,
  kind: Exclude<MediaDiscoveryKind, 'video'>,
  signal?: AbortSignal,
  contentFilter: MediaDiscoveryContentFilter = 'all',
): Promise<MediaDiscoveryAsset[]> {
  const contentQualifier = contentFilter === 'memes'
    ? kind === 'audio' ? 'meme sound' : 'meme image'
    : contentFilter === 'stickers'
      ? 'sticker transparent'
      : contentFilter === 'reactions'
        ? kind === 'audio' ? 'reaction sound' : 'reaction image'
        : contentFilter === 'sound-effects'
          ? 'sound effect'
          : contentFilter === 'music'
            ? 'music'
            : contentFilter === 'viral'
              ? 'internet viral sound'
              : '';
  const url = new URL(`${OPENVERSE_API}/${kind === 'image' ? 'images' : 'audio'}/`);
  const params = new URLSearchParams({
    q: `${query.trim()} ${contentQualifier}`.trim(),
    page_size: '18',
    license: OPENVERSE_LICENSES,
    mature: 'false',
  });
  if (kind === 'image' && contentFilter === 'gifs') params.set('extension', 'gif');
  url.search = params.toString();
  const response = await fetch(url, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    signal: externalRequestSignal(signal, 30_000),
  });
  if (!response.ok) throw new Error(`Openverse search failed (${response.status}).`);
  const payload = await response.json() as { results?: OpenverseResult[] };
  const assets = parseOpenverseResults(payload.results ?? [], kind);
  return kind === 'image' && contentFilter === 'gifs'
    ? assets
      .filter((asset) => asset.mimeType === 'image/gif')
      .map((asset) => ({ ...asset, previewUrl: asset.downloadUrl }))
    : assets;
}
