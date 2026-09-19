import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../../lib/db';
import { plainCommonsMetadata, signCommonsImportToken } from '../../../lib/commonsMedia';
import type { AppContext, AppRouteHandler } from '../../../lib/env';

interface SearchBody {
  limit?: unknown;
  query?: unknown;
}

interface CommonsPage {
  pageid?: number;
  ns?: number;
  title?: string;
  imageinfo?: Array<{
    descriptionurl?: string;
    extmetadata?: Record<string, unknown>;
    height?: number;
    mime?: string;
    thumburl?: string;
    url?: string;
    width?: number;
  }>;
  revisions?: Array<{ revid?: number }>;
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!getCurrentUser(context)) return json({ error: 'Sign in to search Commons.' }, { status: 401 });
  const body = await parseJson<SearchBody>(context.request);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const requestedLimit = typeof body?.limit === 'number' ? body.limit : 6;
  const limit = Math.max(1, Math.min(12, Math.floor(requestedLimit)));
  if (!query || query.length > 240) {
    return json({ error: 'Commons search query must contain 1 to 240 characters.' }, { status: 400 });
  }

  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: String(limit),
    gsrsearch: query,
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '720',
    prop: 'imageinfo|revisions',
    rvprop: 'ids',
  }).toString();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MasterSelects/2.5 (https://www.masterselects.com; support@masterselects.com)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(
      '[CommonsSearch] Upstream request failed:',
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
    return json({ error: 'Wikimedia Commons search request failed.' }, { status: 502 });
  }
  if (!response.ok) {
    const retryAfterSeconds = Number(response.headers.get('Retry-After'));
    const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(5_000, retryAfterSeconds * 1_000)
      : 1_000;
    if (response.status === 429) {
      return json({
        error: 'Wikimedia Commons is rate limiting searches. Retrying shortly may succeed.',
        retryAfterMs,
      }, { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1_000)) } });
    }
    return json({ error: 'Wikimedia Commons search failed.' }, { status: 502 });
  }
  const payload = await response.json() as { query?: { pages?: CommonsPage[] } };
  const pages = Array.isArray(payload.query?.pages) ? payload.query.pages : [];
  const retrievedAt = Date.now();
  const results = await Promise.all(pages.flatMap((page) => {
    const info = page.imageinfo?.[0];
    const metadata = info?.extmetadata ?? {};
    const originalUrl = info?.url;
    const mimeType = info?.mime;
    const title = page.title?.replace(/^File:/u, '').trim();
    const license = plainCommonsMetadata(metadata.LicenseShortName, 160);
    if (
      !page.pageid
      || !title
      || !originalUrl
      || !mimeType?.startsWith('image/')
      || !license
    ) return [];
    return [{ page, info, metadata, originalUrl, mimeType, title, license }];
  }).map(async ({ page, info, metadata, originalUrl, mimeType, title, license }) => ({
    creator: plainCommonsMetadata(metadata.Artist, 500),
    credit: plainCommonsMetadata(metadata.Credit, 500),
    description: plainCommonsMetadata(metadata.ImageDescription, 1_500),
    height: info?.height,
    importToken: await signCommonsImportToken(context.env, {
      expiresAt: Date.now() + 30 * 60 * 1_000,
      mimeType,
      originalUrl,
      title,
      version: 1,
    }),
    license,
    licenseUrl: plainCommonsMetadata(metadata.LicenseUrl, 2_000),
    mimeType,
    originalUrl,
    pageId: page.pageid!,
    retrievedAt,
    revisionId: page.revisions?.[0]?.revid,
    sourceUrl: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? '')}`,
    thumbnailUrl: info?.thumburl ?? originalUrl,
    title,
    width: info?.width,
  })));

  return json({ results });
};
