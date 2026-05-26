import { hasTrustedOrigin, json, methodNotAllowed } from '../../../lib/db';
import type { AppRouteHandler } from '../../../lib/env';

const KIEAI_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';

function getByoKieAiKey(request: Request): string | null {
  const value = request.headers.get('x-kieai-api-key')?.trim();
  return value || null;
}

export const onRequest: AppRouteHandler = async (context): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { Allow: 'POST, OPTIONS' },
      status: 204,
    });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST', 'OPTIONS']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json({ error: 'invalid_origin' }, { status: 403 });
  }

  const apiKey = getByoKieAiKey(context.request);
  if (!apiKey) {
    return json({ error: 'missing_kieai_key' }, { status: 401 });
  }

  const contentType = context.request.headers.get('Content-Type');
  if (!contentType) {
    return json({ error: 'missing_content_type' }, { status: 400 });
  }

  try {
    const upstream = await fetch(KIEAI_UPLOAD_URL, {
      body: context.request.body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      method: 'POST',
    });

    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
      },
      status: upstream.status,
    });
  } catch (error) {
    return json(
      {
        error: 'kieai_upload_proxy_failed',
        message: error instanceof Error ? error.message : 'Failed to upload to Kie.ai',
      },
      { status: 502 },
    );
  }
};
