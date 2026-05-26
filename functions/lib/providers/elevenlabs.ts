import type { Env } from '../env';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

export const HOSTED_ELEVENLABS_PROVIDER = 'elevenlabs';
export const DEFAULT_HOSTED_ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';
export const DEFAULT_HOSTED_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128';
export const HOSTED_ELEVENLABS_USD_PER_PROVIDER_CREDIT = 0.0001;
export const HOSTED_MASTERSELECTS_USD_PER_CREDIT = 0.001;

export const HOSTED_ELEVENLABS_MP3_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_22050_32',
] as const;

type HostedElevenLabsMp3OutputFormat = typeof HOSTED_ELEVENLABS_MP3_OUTPUT_FORMATS[number];

export interface HostedElevenLabsLanguage {
  languageId: string;
  name: string;
}

export interface HostedElevenLabsModelRates {
  characterCostMultiplier?: number;
  costDiscountMultiplier?: number;
}

export interface HostedElevenLabsModel {
  modelId: string;
  name: string;
  description?: string;
  canDoTextToSpeech: boolean;
  canDoVoiceConversion?: boolean;
  canUseStyle: boolean;
  canUseSpeakerBoost: boolean;
  maxCharactersRequestFreeUser?: number;
  maxCharactersRequestSubscribedUser?: number;
  maximumTextLengthPerRequest?: number;
  languages: HostedElevenLabsLanguage[];
  modelRates?: HostedElevenLabsModelRates;
  concurrencyGroup?: string;
}

export interface HostedElevenLabsVoiceSettings {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface HostedElevenLabsVerifiedLanguage {
  language?: string;
  modelId?: string;
  accent?: string;
  locale?: string;
  previewUrl?: string;
}

export interface HostedElevenLabsVoice {
  voiceId: string;
  name: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  labels: Record<string, string>;
  settings?: HostedElevenLabsVoiceSettings;
  highQualityBaseModelIds: string[];
  verifiedLanguages: HostedElevenLabsVerifiedLanguage[];
  availableForTiers: string[];
  isOwner?: boolean;
  isLegacy?: boolean;
  isMixed?: boolean;
  createdAtUnix?: number;
}

export interface HostedElevenLabsVoiceSearchParams {
  nextPageToken?: string;
  pageSize?: number;
  search?: string;
  sort?: 'created_at_unix' | 'name';
  sortDirection?: 'asc' | 'desc';
  voiceType?: string;
  category?: string;
  fineTuningState?: string;
  collectionId?: string;
  includeTotalCount?: boolean;
  voiceIds?: string[];
}

export interface HostedElevenLabsVoiceSearchResult {
  voices: HostedElevenLabsVoice[];
  hasMore: boolean;
  totalCount?: number;
  nextPageToken: string | null;
}

export interface HostedElevenLabsSpeechParams {
  voiceId: string;
  text: string;
  modelId: string;
  languageCode?: string;
  outputFormat: HostedElevenLabsMp3OutputFormat;
  voiceSettings?: HostedElevenLabsVoiceSettings;
}

export interface HostedElevenLabsSpeechCost {
  creditsRequired: number;
  modelMultiplier: number;
  providerCredits: number;
  textCharacters: number;
  usdEstimate: number;
}

export interface HostedElevenLabsSpeechResult {
  audio: ArrayBuffer;
  extension: 'mp3';
  mimeType: 'audio/mpeg';
  outputFormat: HostedElevenLabsMp3OutputFormat;
  providerCharacterCost: number | null;
  providerRequestId: string | null;
  size: number;
}

interface ElevenLabsApiLanguage {
  language_id?: unknown;
  name?: unknown;
}

interface ElevenLabsApiModel {
  model_id?: unknown;
  name?: unknown;
  description?: unknown;
  can_do_text_to_speech?: unknown;
  can_do_voice_conversion?: unknown;
  can_use_style?: unknown;
  can_use_speaker_boost?: unknown;
  max_characters_request_free_user?: unknown;
  max_characters_request_subscribed_user?: unknown;
  maximum_text_length_per_request?: unknown;
  languages?: unknown;
  model_rates?: unknown;
  concurrency_group?: unknown;
}

interface ElevenLabsApiVoice {
  voice_id?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  preview_url?: unknown;
  labels?: unknown;
  settings?: unknown;
  high_quality_base_model_ids?: unknown;
  verified_languages?: unknown;
  available_for_tiers?: unknown;
  is_owner?: unknown;
  is_legacy?: unknown;
  is_mixed?: unknown;
  created_at_unix?: unknown;
}

interface ElevenLabsVoicesApiResponse {
  voices?: unknown;
  has_more?: unknown;
  total_count?: unknown;
  next_page_token?: unknown;
}

interface ElevenLabsApiVoiceSettings {
  speed?: number;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

interface ElevenLabsSpeechApiRequest {
  text: string;
  model_id: string;
  language_code?: string;
  voice_settings?: ElevenLabsApiVoiceSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

function normalizeLanguage(value: unknown): HostedElevenLabsLanguage | null {
  if (!isRecord(value)) {
    return null;
  }

  const language = value as ElevenLabsApiLanguage;
  const languageId = asString(language.language_id);
  const name = asString(language.name);

  if (!languageId || !name) {
    return null;
  }

  return { languageId, name };
}

function normalizeModelRates(value: unknown): HostedElevenLabsModelRates | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rates: HostedElevenLabsModelRates = {
    characterCostMultiplier: asNumber(value.character_cost_multiplier),
    costDiscountMultiplier: asNumber(value.cost_discount_multiplier),
  };

  return Object.values(rates).some((item) => item !== undefined) ? rates : undefined;
}

function normalizeModel(value: unknown): HostedElevenLabsModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const model = value as ElevenLabsApiModel;
  const modelId = asString(model.model_id);
  const name = asString(model.name);
  const canDoTextToSpeech = model.can_do_text_to_speech === true;

  if (!modelId || !name || !canDoTextToSpeech) {
    return null;
  }

  return {
    modelId,
    name,
    description: asString(model.description),
    canDoTextToSpeech,
    canDoVoiceConversion: asBoolean(model.can_do_voice_conversion),
    canUseStyle: model.can_use_style === true,
    canUseSpeakerBoost: model.can_use_speaker_boost === true,
    maxCharactersRequestFreeUser: asNumber(model.max_characters_request_free_user),
    maxCharactersRequestSubscribedUser: asNumber(model.max_characters_request_subscribed_user),
    maximumTextLengthPerRequest: asNumber(model.maximum_text_length_per_request),
    languages: Array.isArray(model.languages)
      ? model.languages.map(normalizeLanguage).filter((language): language is HostedElevenLabsLanguage => language !== null)
      : [],
    modelRates: normalizeModelRates(model.model_rates),
    concurrencyGroup: asString(model.concurrency_group),
  };
}

function normalizeVoiceSettings(value: unknown): HostedElevenLabsVoiceSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const settings: HostedElevenLabsVoiceSettings = {
    speed: asNumber(value.speed),
    stability: asNumber(value.stability),
    similarityBoost: asNumber(value.similarity_boost ?? value.similarityBoost),
    style: asNumber(value.style),
    useSpeakerBoost: asBoolean(value.use_speaker_boost ?? value.useSpeakerBoost),
  };

  return Object.values(settings).some((item) => item !== undefined) ? settings : undefined;
}

function normalizeVerifiedLanguage(value: unknown): HostedElevenLabsVerifiedLanguage | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    language: asString(value.language),
    modelId: asString(value.model_id ?? value.modelId),
    accent: asString(value.accent),
    locale: asString(value.locale),
    previewUrl: asString(value.preview_url ?? value.previewUrl),
  };
}

function normalizeVoice(value: unknown): HostedElevenLabsVoice | null {
  if (!isRecord(value)) {
    return null;
  }

  const voice = value as ElevenLabsApiVoice;
  const voiceId = asString(voice.voice_id);
  const name = asString(voice.name);

  if (!voiceId || !name) {
    return null;
  }

  return {
    voiceId,
    name,
    category: asString(voice.category),
    description: asString(voice.description),
    previewUrl: asString(voice.preview_url),
    labels: normalizeStringRecord(voice.labels),
    settings: normalizeVoiceSettings(voice.settings),
    highQualityBaseModelIds: normalizeStringArray(voice.high_quality_base_model_ids),
    verifiedLanguages: Array.isArray(voice.verified_languages)
      ? voice.verified_languages
        .map(normalizeVerifiedLanguage)
        .filter((language): language is HostedElevenLabsVerifiedLanguage => language !== null)
      : [],
    availableForTiers: normalizeStringArray(voice.available_for_tiers),
    isOwner: asBoolean(voice.is_owner),
    isLegacy: asBoolean(voice.is_legacy),
    isMixed: asBoolean(voice.is_mixed),
    createdAtUnix: asNumber(voice.created_at_unix),
  };
}

function normalizeOutputFormat(value: unknown): HostedElevenLabsMp3OutputFormat {
  return typeof value === 'string' && HOSTED_ELEVENLABS_MP3_OUTPUT_FORMATS.includes(value as HostedElevenLabsMp3OutputFormat)
    ? value as HostedElevenLabsMp3OutputFormat
    : DEFAULT_HOSTED_ELEVENLABS_OUTPUT_FORMAT;
}

function clampOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return undefined;
  }

  return Math.max(min, Math.min(max, numberValue));
}

function normalizeRequestVoiceSettings(value: unknown): HostedElevenLabsVoiceSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const settings: HostedElevenLabsVoiceSettings = {
    speed: clampOptionalNumber(value.speed, 0.7, 1.2),
    stability: clampOptionalNumber(value.stability, 0, 1),
    similarityBoost: clampOptionalNumber(value.similarityBoost ?? value.similarity_boost, 0, 1),
    style: clampOptionalNumber(value.style, 0, 1),
    useSpeakerBoost: asBoolean(value.useSpeakerBoost ?? value.use_speaker_boost),
  };

  return Object.values(settings).some((item) => item !== undefined) ? settings : undefined;
}

function toProviderVoiceSettings(settings: HostedElevenLabsVoiceSettings | undefined): ElevenLabsApiVoiceSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const result: ElevenLabsApiVoiceSettings = {};

  if (settings.speed !== undefined) result.speed = settings.speed;
  if (settings.stability !== undefined) result.stability = settings.stability;
  if (settings.similarityBoost !== undefined) result.similarity_boost = settings.similarityBoost;
  if (settings.style !== undefined) result.style = settings.style;
  if (settings.useSpeakerBoost !== undefined) result.use_speaker_boost = settings.useSpeakerBoost;

  return Object.keys(result).length > 0 ? result : undefined;
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined || value === '') {
    return;
  }

  searchParams.set(key, String(value));
}

function getApiKey(env: Env): string {
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not configured for MasterSelects Cloud.');
  }

  return apiKey;
}

function getJsonHeaders(env: Env): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'xi-api-key': getApiKey(env),
  };
}

function extractProviderMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractProviderMessage(item);
      if (message) return message;
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['message', 'detail', 'error', 'msg']) {
    const message = extractProviderMessage(value[key]);
    if (message) return message;
  }

  return null;
}

async function readProviderError(response: Response): Promise<Error> {
  let providerMessage: string | null = null;

  try {
    const text = await response.text();
    if (text.trim()) {
      try {
        providerMessage = extractProviderMessage(JSON.parse(text));
      } catch {
        providerMessage = text.trim();
      }
    }
  } catch {
    providerMessage = null;
  }

  return new Error(providerMessage ? `ElevenLabs request failed: ${providerMessage}` : `ElevenLabs request failed with status ${response.status}.`);
}

async function fetchElevenLabsJson<T>(env: Env, endpoint: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${ELEVENLABS_BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      ...getJsonHeaders(env),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await readProviderError(response);
  }

  return await response.json() as T;
}

function readProviderCharacterCost(response: Response): number | null {
  const raw = response.headers.get('x-character-count') ?? response.headers.get('X-Character-Count');
  if (!raw) {
    return null;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function isFlashOrTurboElevenLabsModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.includes('flash') || normalized.includes('turbo');
}

export function getHostedElevenLabsModelMultiplier(
  modelId: string,
  modelRates?: HostedElevenLabsModelRates | null,
): number {
  const explicitMultiplier = modelRates?.characterCostMultiplier;
  if (typeof explicitMultiplier === 'number' && Number.isFinite(explicitMultiplier) && explicitMultiplier > 0) {
    return explicitMultiplier;
  }

  return isFlashOrTurboElevenLabsModel(modelId) ? 0.5 : 1;
}

export function calculateHostedElevenLabsCredits(providerCredits: number): number {
  if (!Number.isFinite(providerCredits) || providerCredits <= 0) {
    return 0;
  }

  const usd = providerCredits * HOSTED_ELEVENLABS_USD_PER_PROVIDER_CREDIT;
  return Math.max(1, Math.ceil(usd / HOSTED_MASTERSELECTS_USD_PER_CREDIT));
}

export function estimateHostedElevenLabsSpeechCost(params: Pick<HostedElevenLabsSpeechParams, 'modelId' | 'text'>): HostedElevenLabsSpeechCost {
  const textCharacters = params.text.length;
  const modelMultiplier = getHostedElevenLabsModelMultiplier(params.modelId);
  const providerCredits = Math.ceil(textCharacters * modelMultiplier);
  const creditsRequired = calculateHostedElevenLabsCredits(providerCredits);

  return {
    creditsRequired,
    modelMultiplier,
    providerCredits,
    textCharacters,
    usdEstimate: providerCredits * HOSTED_ELEVENLABS_USD_PER_PROVIDER_CREDIT,
  };
}

export function normalizeHostedElevenLabsSpeechParams(value: unknown): HostedElevenLabsSpeechParams | null {
  if (!isRecord(value)) {
    return null;
  }

  const voiceId = asString(value.voiceId ?? value.voice_id);
  const text = asString(value.text);

  if (!voiceId || !text) {
    return null;
  }

  return {
    voiceId,
    text,
    modelId: asString(value.modelId ?? value.model_id) ?? DEFAULT_HOSTED_ELEVENLABS_MODEL_ID,
    languageCode: asString(value.languageCode ?? value.language_code),
    outputFormat: normalizeOutputFormat(value.outputFormat ?? value.output_format),
    voiceSettings: normalizeRequestVoiceSettings(value.voiceSettings ?? value.voice_settings),
  };
}

export function normalizeHostedElevenLabsVoiceSearchParams(value: URLSearchParams): HostedElevenLabsVoiceSearchParams {
  const pageSize = Number(value.get('pageSize') ?? value.get('page_size') ?? '');
  const includeTotalCount = value.get('includeTotalCount') ?? value.get('include_total_count');
  const voiceIds = value.getAll('voiceIds').concat(value.getAll('voice_ids'));

  return {
    nextPageToken: asString(value.get('nextPageToken') ?? value.get('next_page_token')),
    pageSize: Number.isFinite(pageSize) ? Math.max(1, Math.min(100, Math.floor(pageSize))) : undefined,
    search: asString(value.get('search')),
    sort: value.get('sort') === 'created_at_unix' ? 'created_at_unix' : 'name',
    sortDirection: value.get('sortDirection') === 'desc' || value.get('sort_direction') === 'desc' ? 'desc' : 'asc',
    voiceType: asString(value.get('voiceType') ?? value.get('voice_type')),
    category: asString(value.get('category')),
    fineTuningState: asString(value.get('fineTuningState') ?? value.get('fine_tuning_state')),
    collectionId: asString(value.get('collectionId') ?? value.get('collection_id')),
    includeTotalCount: includeTotalCount === 'true' || includeTotalCount === '1',
    voiceIds: voiceIds.filter((voiceId) => voiceId.trim().length > 0),
  };
}

export function buildHostedElevenLabsCapabilities(): Record<string, unknown> {
  return {
    byoExplicit: true,
    provider: HOSTED_ELEVENLABS_PROVIDER,
    outputFormats: [...HOSTED_ELEVENLABS_MP3_OUTPUT_FORMATS],
    defaultModelId: DEFAULT_HOSTED_ELEVENLABS_MODEL_ID,
    metering: {
      unit: 'provider_credit',
      providerUsdPerCredit: HOSTED_ELEVENLABS_USD_PER_PROVIDER_CREDIT,
      masterselectsUsdPerCredit: HOSTED_MASTERSELECTS_USD_PER_CREDIT,
      flashTurboApiCharacterMultiplier: 0.5,
      defaultCharacterMultiplier: 1,
    },
  };
}

export async function listHostedElevenLabsModels(env: Env): Promise<HostedElevenLabsModel[]> {
  const response = await fetchElevenLabsJson<unknown>(env, '/v1/models', {
    method: 'GET',
  });

  if (!Array.isArray(response)) {
    throw new Error('ElevenLabs returned an invalid models response.');
  }

  return response.map(normalizeModel).filter((model): model is HostedElevenLabsModel => model !== null);
}

export async function listHostedElevenLabsVoices(
  env: Env,
  params: HostedElevenLabsVoiceSearchParams = {},
): Promise<HostedElevenLabsVoiceSearchResult> {
  const searchParams = new URLSearchParams();
  const pageSize = params.pageSize === undefined ? undefined : Math.min(100, Math.max(1, Math.floor(params.pageSize)));

  appendQueryParam(searchParams, 'next_page_token', params.nextPageToken);
  appendQueryParam(searchParams, 'page_size', pageSize);
  appendQueryParam(searchParams, 'search', params.search?.trim());
  appendQueryParam(searchParams, 'sort', params.sort);
  appendQueryParam(searchParams, 'sort_direction', params.sortDirection);
  appendQueryParam(searchParams, 'voice_type', params.voiceType);
  appendQueryParam(searchParams, 'category', params.category);
  appendQueryParam(searchParams, 'fine_tuning_state', params.fineTuningState);
  appendQueryParam(searchParams, 'collection_id', params.collectionId);
  appendQueryParam(searchParams, 'include_total_count', params.includeTotalCount);

  for (const voiceId of params.voiceIds ?? []) {
    if (voiceId.trim()) {
      searchParams.append('voice_ids', voiceId.trim());
    }
  }

  const endpoint = `/v2/voices${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`;
  const response = await fetchElevenLabsJson<ElevenLabsVoicesApiResponse>(env, endpoint, {
    method: 'GET',
  });

  if (!Array.isArray(response.voices)) {
    throw new Error('ElevenLabs returned an invalid voices response.');
  }

  return {
    voices: response.voices.map(normalizeVoice).filter((voice): voice is HostedElevenLabsVoice => voice !== null),
    hasMore: response.has_more === true,
    totalCount: asNumber(response.total_count),
    nextPageToken: asString(response.next_page_token) ?? null,
  };
}

export async function createHostedElevenLabsSpeech(
  env: Env,
  params: HostedElevenLabsSpeechParams,
): Promise<HostedElevenLabsSpeechResult> {
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(params.voiceId)}`, ELEVENLABS_BASE_URL);
  url.searchParams.set('output_format', params.outputFormat);

  const body: ElevenLabsSpeechApiRequest = {
    text: params.text,
    model_id: params.modelId,
  };

  if (params.languageCode) {
    body.language_code = params.languageCode;
  }

  const voiceSettings = toProviderVoiceSettings(params.voiceSettings);
  if (voiceSettings) {
    body.voice_settings = voiceSettings;
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      ...getJsonHeaders(env),
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await readProviderError(response);
  }

  const audio = await response.arrayBuffer();

  return {
    audio,
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    outputFormat: params.outputFormat,
    providerCharacterCost: readProviderCharacterCost(response),
    providerRequestId: response.headers.get('request-id'),
    size: audio.byteLength,
  };
}
