import {
  BASE_URL,
  BYO_PROXY_REQUEST_URL,
  canUseSameOriginProxy,
} from './config';

export type KieChatEndpoint = '/claude/v1/messages' | '/codex/v1/responses';

function readKieChatError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (typeof record.msg === 'string' && record.msg.trim()) {
      return record.msg;
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error;
    }
    if (record.error && typeof record.error === 'object') {
      const message = (record.error as Record<string, unknown>).message;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
  }
  return `Kie.ai chat request failed: ${status}`;
}

export async function requestKieChatByo({
  apiKey,
  body,
  endpoint,
  signal,
}: {
  apiKey: string;
  body: Record<string, unknown>;
  endpoint: KieChatEndpoint;
  signal?: AbortSignal;
}): Promise<unknown> {
  const normalizedApiKey = apiKey.trim();
  if (!normalizedApiKey) {
    throw new Error('Add a Kie.ai API key in Settings to use chat.');
  }

  const response = canUseSameOriginProxy()
    ? await fetch(BYO_PROXY_REQUEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kieai-api-key': normalizedApiKey,
        },
        body: JSON.stringify({ body, endpoint, method: 'POST' }),
        signal,
      })
    : await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${normalizedApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
  const responseText = await response.text();
  let payload: unknown = null;

  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    payload = {
      error: {
        message: responseText.slice(0, 500),
      },
    };
  }

  if (!response.ok) {
    throw new Error(readKieChatError(payload, response.status));
  }
  return payload;
}
