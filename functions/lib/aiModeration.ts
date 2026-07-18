import { getOpenAIKey } from './openai';
import type { Env } from './env';

export type AiModerationStatus = 'clean' | 'flagged' | 'error' | 'skipped';

export interface AiModerationResult {
  categories: string[];
  errorMessage: string | null;
  flagged: boolean;
  payload: unknown;
  status: AiModerationStatus;
}

interface OpenAIModerationPayload {
  results?: Array<{
    categories?: Record<string, boolean>;
    flagged?: boolean;
  }>;
}

function toModerationText(value: unknown): string {
  if (typeof value === 'string') {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) ? '' : value;
  }
  if (Array.isArray(value)) return value.map(toModerationText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.prompt === 'string') return record.prompt;
    return Object.values(record).map(toModerationText).filter(Boolean).join('\n');
  }

  return '';
}

export function buildModerationInput(value: unknown): string {
  return toModerationText(value).trim().slice(0, 20_000);
}

export async function moderateAiInput(env: Env, value: unknown): Promise<AiModerationResult> {
  const input = buildModerationInput(value);
  if (!input) {
    return { categories: [], errorMessage: null, flagged: false, payload: null, status: 'skipped' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      body: JSON.stringify({ input, model: 'omni-moderation-latest' }),
      headers: {
        Authorization: `Bearer ${getOpenAIKey(env)}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const payload = await response.json().catch(() => null) as OpenAIModerationPayload & {
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      return {
        categories: [],
        errorMessage: payload?.error?.message ?? `OpenAI moderation failed with status ${response.status}`,
        flagged: false,
        payload,
        status: 'error',
      };
    }

    const result = payload?.results?.[0];
    const categories = Object.entries(result?.categories ?? {})
      .filter(([, flagged]) => flagged)
      .map(([category]) => category);
    const flagged = result?.flagged === true;

    return {
      categories,
      errorMessage: null,
      flagged,
      payload,
      status: flagged ? 'flagged' : 'clean',
    };
  } catch (error) {
    return {
      categories: [],
      errorMessage: error instanceof Error ? error.message : 'OpenAI moderation failed.',
      flagged: false,
      payload: null,
      status: 'error',
    };
  }
}

export function blocksAiRequest(moderation: AiModerationResult): boolean {
  return moderation.status === 'flagged' || moderation.status === 'error';
}
