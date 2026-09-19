import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../../lib/db';
import { signCommonsImportToken } from '../../../lib/commonsMedia';
import type { AppContext, AppRouteHandler } from '../../../lib/env';

interface CommonsPage {
  imageinfo?: Array<{ mime?: string; url?: string }>;
  title?: string;
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!getCurrentUser(context)) return json({ error: 'Sign in to refresh Commons media.' }, { status: 401 });
  const body = await parseJson<{ pageId?: unknown }>(context.request);
  const pageId = typeof body?.pageId === 'number' ? Math.floor(body.pageId) : 0;
  if (!Number.isSafeInteger(pageId) || pageId < 1) {
    return json({ error: 'A valid Commons page ID is required.' }, { status: 400 });
  }

  const url = new URL(COMMONS_API);
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    pageids: String(pageId),
    prop: 'imageinfo',
    iiprop: 'url|mime',
  }).toString();
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'MasterSelects/2.4 Commons refresh' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return json({ error: 'Wikimedia Commons refresh failed.' }, { status: 502 });
  const payload = await response.json() as { query?: { pages?: CommonsPage[] } };
  const page = payload.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  const title = page?.title?.replace(/^File:/u, '').trim();
  if (!title || !info?.url || !info.mime?.startsWith('image/')) {
    return json({ error: 'The Commons image is no longer available.' }, { status: 404 });
  }
  const importToken = await signCommonsImportToken(context.env, {
    expiresAt: Date.now() + 30 * 60 * 1_000,
    mimeType: info.mime,
    originalUrl: info.url,
    title,
    version: 1,
  });
  return json({ importToken });
};
