import type { Env } from './env';

/**
 * OpenAI remains an infrastructure dependency for moderation and
 * transcription. Hosted generative chat is routed through Kie.ai.
 */
export function getOpenAIKey(env: Env): string {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return apiKey;
}
