import type {
  MediaDiscoveryAsset,
  MediaDiscoveryContentFilter,
  MediaDiscoveryKind,
} from './types';
import { externalRequestSignal, plainExternalText, safeHttpsUrl } from './text';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

interface CommonsPage {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    descriptionurl?: string;
    extmetadata?: Record<string, unknown>;
    height?: number;
    mime?: string;
    size?: number;
    thumburl?: string;
    url?: string;
    width?: number;
  }>;
}

function fileTypeQuery(kind: MediaDiscoveryKind, contentFilter: MediaDiscoveryContentFilter): string {
  if (kind === 'image' && contentFilter === 'gifs') return 'filetype:bitmap filemime:image/gif';
  if (kind === 'image') return 'filetype:bitmap';
  return `filetype:${kind}`;
}

function contentQuery(
  kind: MediaDiscoveryKind,
  contentFilter: MediaDiscoveryContentFilter,
): string {
  if (contentFilter === 'memes') return kind === 'audio' ? 'meme sound' : `meme ${kind}`;
  if (contentFilter === 'stickers') return 'sticker transparent';
  if (contentFilter === 'reactions') return kind === 'audio' ? 'reaction sound' : `reaction ${kind}`;
  if (contentFilter === 'green-screen') return 'green screen';
  if (contentFilter === 'overlays') return 'overlay';
  if (contentFilter === 'sound-effects') return 'sound effect';
  if (contentFilter === 'music') return 'music';
  if (contentFilter === 'viral') return 'internet viral sound';
  return '';
}

function normalizeMimeType(mimeType: string | undefined, kind: MediaDiscoveryKind): string | undefined {
  if (!mimeType) return undefined;
  if (mimeType === 'application/ogg') return kind === 'video' ? 'video/ogg' : 'audio/ogg';
  return mimeType;
}

export function parseWikimediaCommonsPages(
  pages: CommonsPage[],
  kind: MediaDiscoveryKind,
): MediaDiscoveryAsset[] {
  return pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    const metadata = info?.extmetadata ?? {};
    const downloadUrl = safeHttpsUrl(info?.url);
    const sourcePageUrl = safeHttpsUrl(info?.descriptionurl);
    const title = plainExternalText(page.title?.replace(/^File:/u, ''), 240);
    const licenseName = plainExternalText(metadata.LicenseShortName, 120)
      ?? plainExternalText(metadata.UsageTerms, 120);
    const mimeType = normalizeMimeType(info?.mime, kind);
    if (!page.pageid || !downloadUrl || !sourcePageUrl || !title || !licenseName || !mimeType) return [];
    if (kind !== 'audio' && !mimeType.startsWith(`${kind}/`)) return [];
    if (kind === 'audio' && !mimeType.startsWith('audio/')) return [];

    const creator = plainExternalText(metadata.Artist, 500);
    const credit = plainExternalText(metadata.Credit, 500);
    return [{
      id: String(page.pageid),
      provider: 'wikimedia-commons' as const,
      providerLabel: 'Wikimedia Commons',
      kind,
      title,
      previewUrl: safeHttpsUrl(info?.thumburl),
      downloadUrl,
      sourcePageUrl,
      creator,
      licenseName,
      licenseUrl: safeHttpsUrl(plainExternalText(metadata.LicenseUrl, 2_000)),
      attribution: credit ?? creator,
      rightsStatus: 'open-license',
      mimeType,
      fileSize: info?.size,
      width: info?.width,
      height: info?.height,
    }];
  });
}

export async function searchWikimediaCommons(
  query: string,
  kind: MediaDiscoveryKind,
  signal?: AbortSignal,
  contentFilter: MediaDiscoveryContentFilter = 'all',
): Promise<MediaDiscoveryAsset[]> {
  const qualifier = contentQuery(kind, contentFilter);
  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '18',
    gsrsearch: `${query.trim()} ${qualifier} ${fileTypeQuery(kind, contentFilter)}`.replace(/\s+/gu, ' ').trim(),
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '720',
    origin: '*',
    prop: 'imageinfo',
  }).toString();

  const response = await fetch(url, {
    credentials: 'omit',
    headers: { Accept: 'application/json' },
    referrerPolicy: 'no-referrer',
    signal: externalRequestSignal(signal, 30_000),
  });
  if (!response.ok) throw new Error(`Commons search failed (${response.status}).`);
  const payload = await response.json() as { query?: { pages?: CommonsPage[] } };
  const assets = parseWikimediaCommonsPages(payload.query?.pages ?? [], kind);
  return kind === 'image' && contentFilter === 'gifs'
    ? assets
      .filter((asset) => asset.mimeType === 'image/gif')
      .map((asset) => ({ ...asset, previewUrl: asset.downloadUrl }))
    : assets;
}
