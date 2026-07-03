import type { Env } from './env';

export function getOpenAIKey(env: Env): string {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return apiKey;
}

export async function createOpenAIChatCompletion(
  env: Env,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getOpenAIKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload: unknown = null;

  try {
    payload = responseText.length > 0 ? JSON.parse(responseText) : null;
  } catch {
    payload = {
      error: {
        message: responseText.slice(0, 500),
      },
    };
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload &&
      'error' in payload &&
      typeof payload.error === 'object' &&
      payload.error &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `OpenAI request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload;
}
