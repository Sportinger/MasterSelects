import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../../lib/db';
import { verifyCommonsImportToken } from '../../../lib/commonsMedia';
import type { AppContext, AppRouteHandler } from '../../../lib/env';

const MAX_COMMONS_IMAGE_BYTES = 40 * 1024 * 1024;

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!getCurrentUser(context)) return json({ error: 'Sign in to import Commons media.' }, { status: 401 });
  const body = await parseJson<{ token?: unknown }>(context.request);
  if (typeof body?.token !== 'string' || body.token.length > 16_000) {
    return json({ error: 'A valid Commons import token is required.' }, { status: 400 });
  }
  let payload;
  try {
    payload = await verifyCommonsImportToken(context.env, body.token);
  } catch (error) {
    console.error('[commons] import token rejected', context.data.requestId, error instanceof Error ? error.message : error);
    return json({ error: 'Invalid Commons import token.', requestId: context.data.requestId ?? null }, { status: 400 });
  }
  const response = await fetch(payload.originalUrl, {
    headers: { Accept: 'image/*', 'User-Agent': 'MasterSelects/2.4 Commons import' },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.body) {
    return json({ error: 'Wikimedia Commons media download failed.' }, { status: 502 });
  }
  const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '';
  const contentLength = Number(response.headers.get('Content-Length') ?? '0');
  if (
    !contentType.startsWith('image/')
    || contentType !== payload.mimeType
    || (Number.isFinite(contentLength) && contentLength > MAX_COMMONS_IMAGE_BYTES)
  ) return json({ error: 'Commons media type or size is not allowed.' }, { status: 415 });

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_COMMONS_IMAGE_BYTES) {
    return json({ error: 'Commons media exceeds the 40 MB import limit.' }, { status: 413 });
  }
  return new Response(bytes, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${payload.title.replace(/["\\\r\n]/gu, '_')}"`,
      'Content-Type': contentType,
    },
  });
};
