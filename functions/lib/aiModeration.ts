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

export interface AiModerationBlockingOptions {
  allowedFlaggedCategories?: readonly string[];
}

interface OpenAIModerationPayload {
  results?: Array<{
    categories?: Record<string, boolean>;
    flagged?: boolean;
  }>;
}

type ModerationInput = string | Array<{ type: 'image_url'; image_url: { url: string } }>;

interface SingleModerationOutcome {
  categories: string[];
  errorMessage: string | null;
  payload: unknown;
}

const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';
const OPENAI_MODERATION_MODEL = 'omni-moderation-latest';

// Images flagged only for other categories (e.g. non-graphic violence in an
// action scene) stay allowed; these are the categories that block an image.
export const IMAGE_BLOCKING_CATEGORIES: readonly string[] = ['sexual', 'sexual/minors', 'violence/graphic'];
// Chat histories resend earlier frames every turn; the newest images are checked.
export const MAX_MODERATED_IMAGES = 12;

// Chat turns resend earlier frames; remember verdicts for identical image bytes
// per isolate. Only data URLs are cached: content behind an http URL can change.
const IMAGE_VERDICT_TTL_MS = 60 * 60 * 1000;
const IMAGE_VERDICT_CACHE_LIMIT = 500;
const imageVerdictCache = new Map<string, { categories: string[]; expiresAt: number }>();

const DATA_URL_PREFIX = /^data:[^;,\s]+;base64,/i;
const IMAGE_DATA_URL_PREFIX = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
const HTTP_URL_PREFIX = /^https?:\/\//i;
const IMAGE_URL_KEYS = new Set(['endImageUrl', 'imageInputs', 'imageUrl', 'image_url', 'startImageUrl']);

function isBase64Source(record: Record<string, unknown>): boolean {
  return record.type === 'base64' && typeof record.data === 'string';
}

function toModerationText(value: unknown): string {
  if (typeof value === 'string') {
    return DATA_URL_PREFIX.test(value) ? '' : value;
  }
  if (Array.isArray(value)) return value.map(toModerationText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.prompt === 'string') return record.prompt;
    if (isBase64Source(record)) return '';
    return Object.values(record).map(toModerationText).filter(Boolean).join('\n');
  }

  return '';
}

export function buildModerationInput(value: unknown): string {
  return toModerationText(value).trim().slice(0, 20_000);
}

function collectImages(value: unknown, inImageContext: boolean, images: string[]): void {
  if (typeof value === 'string') {
    if (IMAGE_DATA_URL_PREFIX.test(value) || (inImageContext && HTTP_URL_PREFIX.test(value))) {
      images.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImages(entry, inImageContext, images));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (isBase64Source(record)) {
    const mediaType = typeof record.media_type === 'string' ? record.media_type : '';
    const dataUrl = `data:${mediaType};base64,${record.data as string}`;
    if (IMAGE_DATA_URL_PREFIX.test(dataUrl)) images.push(dataUrl);
    return;
  }

  const isImageReference = record.mediaType === 'image';
  for (const [key, entry] of Object.entries(record)) {
    collectImages(entry, inImageContext || IMAGE_URL_KEYS.has(key) || (isImageReference && key === 'source'), images);
  }
}

/** Unique image URLs (data or http) in a request payload, newest last, capped. */
export function collectModerationImages(value: unknown): string[] {
  const images: string[] = [];
  collectImages(value, false, images);
  return [...new Set(images)].slice(-MAX_MODERATED_IMAGES);
}

async function requestModeration(env: Env, input: ModerationInput): Promise<SingleModerationOutcome> {
  try {
    const response = await fetch(OPENAI_MODERATION_URL, {
      body: JSON.stringify({ input, model: OPENAI_MODERATION_MODEL }),
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
        payload,
      };
    }

    const result = payload?.results?.[0];
    const categories = Object.entries(result?.categories ?? {})
      .filter(([, flagged]) => flagged)
      .map(([category]) => category);
    // Keep a flagged text result without a named category blocking.
    if (result?.flagged === true && categories.length === 0) categories.push('unspecified');

    return { categories, errorMessage: null, payload };
  } catch (error) {
    return {
      categories: [],
      errorMessage: error instanceof Error ? error.message : 'OpenAI moderation failed.',
      payload: null,
    };
  }
}

export function clearImageModerationCache(): void {
  imageVerdictCache.clear();
}

async function imageCacheKey(url: string): Promise<string | null> {
  if (!IMAGE_DATA_URL_PREFIX.test(url)) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCachedImageVerdict(key: string, now: number): string[] | null {
  const entry = imageVerdictCache.get(key);
  if (!entry) return null;
  imageVerdictCache.delete(key);
  if (entry.expiresAt <= now) return null;
  imageVerdictCache.set(key, entry);
  return entry.categories;
}

function storeImageVerdict(key: string, categories: string[], now: number): void {
  imageVerdictCache.delete(key);
  imageVerdictCache.set(key, { categories, expiresAt: now + IMAGE_VERDICT_TTL_MS });
  while (imageVerdictCache.size > IMAGE_VERDICT_CACHE_LIMIT) {
    const oldestKey = imageVerdictCache.keys().next().value;
    if (oldestKey === undefined) break;
    imageVerdictCache.delete(oldestKey);
  }
}

async function moderateImage(env: Env, url: string): Promise<SingleModerationOutcome> {
  const key = await imageCacheKey(url);
  const cached = key ? readCachedImageVerdict(key, Date.now()) : null;
  if (cached) return { categories: cached, errorMessage: null, payload: { cached: true } };

  const outcome = await requestModeration(env, [{ type: 'image_url', image_url: { url } }]);
  if (key && !outcome.errorMessage) storeImageVerdict(key, outcome.categories, Date.now());
  return outcome;
}

export interface AiModerationContent {
  images?: readonly string[];
  text?: string;
}

/** Moderates text and an explicit image list; callers choose which images to check. */
export async function moderateAiContent(env: Env, content: AiModerationContent): Promise<AiModerationResult> {
  const text = content.text?.trim().slice(0, 20_000) ?? '';
  const images = [...new Set(content.images ?? [])];
  if (!text && images.length === 0) {
    return { categories: [], errorMessage: null, flagged: false, payload: null, status: 'skipped' };
  }

  // One request per image keeps each verdict independent of per-request image limits.
  const [textOutcome, ...imageOutcomes] = await Promise.all([
    text ? requestModeration(env, text) : Promise.resolve(null),
    ...images.map((url) => moderateImage(env, url)),
  ]);

  const payload = { images: imageOutcomes.map((outcome) => outcome.payload), text: textOutcome?.payload ?? null };
  const failed = [textOutcome, ...imageOutcomes].find((outcome) => outcome?.errorMessage);
  if (failed) {
    return { categories: [], errorMessage: failed.errorMessage, flagged: false, payload, status: 'error' };
  }

  const imageCategories = imageOutcomes
    .flatMap((outcome) => outcome.categories)
    .filter((category) => IMAGE_BLOCKING_CATEGORIES.includes(category))
    .map((category) => `image:${category}`);
  const categories = [...new Set([...(textOutcome?.categories ?? []), ...imageCategories])];
  const flagged = categories.length > 0;

  return { categories, errorMessage: null, flagged, payload, status: flagged ? 'flagged' : 'clean' };
}

export async function moderateAiInput(env: Env, value: unknown): Promise<AiModerationResult> {
  return moderateAiContent(env, {
    images: collectModerationImages(value),
    text: buildModerationInput(value),
  });
}

export function blocksAiRequest(
  moderation: AiModerationResult,
  options: AiModerationBlockingOptions = {},
): boolean {
  if (moderation.status === 'error') return true;
  if (moderation.status !== 'flagged') return false;

  const allowedCategories = new Set(options.allowedFlaggedCategories ?? []);
  return moderation.categories.length === 0
    || moderation.categories.some((category) => !allowedCategories.has(category));
}
