import { Logger } from './logger';

const log = Logger.create('ElevenLabs');

const BASE_URL = 'https://api.elevenlabs.io';

export const ELEVENLABS_MP3_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_22050_32',
] as const;

export type ElevenLabsMp3OutputFormat = typeof ELEVENLABS_MP3_OUTPUT_FORMATS[number];

export const DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT: ElevenLabsMp3OutputFormat = 'mp3_44100_128';
export const ELEVENLABS_MP3_MIME_TYPE = 'audio/mpeg';
export const ELEVENLABS_MP3_EXTENSION = 'mp3';
export const ELEVENLABS_PROVIDER_USD_PER_CREDIT = 0.0001;
export const MASTERSELECTS_HOSTED_USD_PER_CREDIT = 0.001;

export type ElevenLabsErrorCode =
  | 'missing_api_key'
  | 'invalid_request'
  | 'network_error'
  | 'provider_error'
  | 'unauthorized'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'aborted'
  | 'unsupported_format'
  | 'invalid_response';

export interface ElevenLabsLanguage {
  languageId: string;
  name: string;
}

export interface ElevenLabsModelRates {
  characterCostMultiplier?: number;
  costDiscountMultiplier?: number;
}

export interface HostedElevenLabsSpeechCostEstimate {
  creditsRequired: number;
  modelMultiplier: number;
  providerCredits: number;
  textCharacters: number;
  usdEstimate: number;
}

export function isFlashOrTurboElevenLabsModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.includes('flash') || normalized.includes('turbo');
}

export function getElevenLabsModelCharacterCostMultiplier(
  modelId: string,
  modelRates?: ElevenLabsModelRates | null,
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

  return Math.max(1, Math.ceil((providerCredits * ELEVENLABS_PROVIDER_USD_PER_CREDIT) / MASTERSELECTS_HOSTED_USD_PER_CREDIT));
}

export function estimateHostedElevenLabsSpeechCredits(
  text: string,
  modelId: string,
  modelRates?: ElevenLabsModelRates | null,
): HostedElevenLabsSpeechCostEstimate {
  const textCharacters = text.length;
  const modelMultiplier = getElevenLabsModelCharacterCostMultiplier(modelId, modelRates);
  const providerCredits = Math.ceil(textCharacters * modelMultiplier);
  const creditsRequired = calculateHostedElevenLabsCredits(providerCredits);

  return {
    creditsRequired,
    modelMultiplier,
    providerCredits,
    textCharacters,
    usdEstimate: providerCredits * ELEVENLABS_PROVIDER_USD_PER_CREDIT,
  };
}

export interface ElevenLabsModel {
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
  languages: ElevenLabsLanguage[];
  modelRates?: ElevenLabsModelRates;
  concurrencyGroup?: string;
}

export interface ElevenLabsVoiceSettings {
  speed?: number;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
}

export interface ElevenLabsVerifiedLanguage {
  language?: string;
  modelId?: string;
  accent?: string;
  locale?: string;
  previewUrl?: string;
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  labels: Record<string, string>;
  settings?: ElevenLabsVoiceSettings;
  highQualityBaseModelIds: string[];
  verifiedLanguages: ElevenLabsVerifiedLanguage[];
  availableForTiers: string[];
  isOwner?: boolean;
  isLegacy?: boolean;
  isMixed?: boolean;
  createdAtUnix?: number;
}

export type ElevenLabsVoiceSort = 'created_at_unix' | 'name';
export type ElevenLabsVoiceSortDirection = 'asc' | 'desc';
export type ElevenLabsVoiceType =
  | 'personal'
  | 'community'
  | 'default'
  | 'workspace'
  | 'non-default'
  | 'non-community'
  | 'saved';
export type ElevenLabsVoiceCategory = 'premade' | 'cloned' | 'generated' | 'professional';
export type ElevenLabsFineTuningState =
  | 'draft'
  | 'not_verified'
  | 'not_started'
  | 'queued'
  | 'fine_tuning'
  | 'fine_tuned'
  | 'failed'
  | 'delayed';

export interface ElevenLabsVoiceSearchParams {
  nextPageToken?: string;
  pageSize?: number;
  search?: string;
  sort?: ElevenLabsVoiceSort;
  sortDirection?: ElevenLabsVoiceSortDirection;
  voiceType?: ElevenLabsVoiceType;
  category?: ElevenLabsVoiceCategory;
  fineTuningState?: ElevenLabsFineTuningState;
  collectionId?: string;
  includeTotalCount?: boolean;
  voiceIds?: string[];
}

export interface ElevenLabsVoiceSearchResult {
  voices: ElevenLabsVoice[];
  hasMore: boolean;
  totalCount?: number;
  nextPageToken: string | null;
}

export interface ElevenLabsCreateSpeechParams {
  voiceId: string;
  text: string;
  modelId?: string;
  languageCode?: string;
  outputFormat?: ElevenLabsMp3OutputFormat;
  voiceSettings?: ElevenLabsVoiceSettings;
}

export interface ElevenLabsSpeechResult {
  audio: Blob;
  mimeType: typeof ELEVENLABS_MP3_MIME_TYPE;
  extension: typeof ELEVENLABS_MP3_EXTENSION;
  outputFormat: ElevenLabsMp3OutputFormat;
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
  model_id?: string;
  language_code?: string;
  voice_settings?: ElevenLabsApiVoiceSettings;
}

interface ServiceErrorOptions {
  status?: number;
  retryable?: boolean;
}

export class ElevenLabsServiceError extends Error {
  code: ElevenLabsErrorCode;
  status?: number;
  retryable: boolean;

  constructor(message: string, code: ElevenLabsErrorCode, options: ServiceErrorOptions = {}) {
    super(message);
    this.name = 'ElevenLabsServiceError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
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

function normalizeVoiceSettings(value: unknown): ElevenLabsVoiceSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const settings: ElevenLabsVoiceSettings = {
    speed: asNumber(value.speed),
    stability: asNumber(value.stability),
    similarityBoost: asNumber(value.similarity_boost),
    style: asNumber(value.style),
    useSpeakerBoost: asBoolean(value.use_speaker_boost),
  };

  return Object.values(settings).some((item) => item !== undefined) ? settings : undefined;
}

function normalizeLanguage(value: unknown): ElevenLabsLanguage | null {
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

function normalizeModelRates(value: unknown): ElevenLabsModelRates | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rates: ElevenLabsModelRates = {
    characterCostMultiplier: asNumber(value.character_cost_multiplier),
    costDiscountMultiplier: asNumber(value.cost_discount_multiplier),
  };

  return Object.values(rates).some((item) => item !== undefined) ? rates : undefined;
}

function normalizeModel(value: unknown): ElevenLabsModel | null {
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
      ? model.languages.map(normalizeLanguage).filter((language): language is ElevenLabsLanguage => language !== null)
      : [],
    modelRates: normalizeModelRates(model.model_rates),
    concurrencyGroup: asString(model.concurrency_group),
  };
}

function normalizeVerifiedLanguage(value: unknown): ElevenLabsVerifiedLanguage | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    language: asString(value.language),
    modelId: asString(value.model_id),
    accent: asString(value.accent),
    locale: asString(value.locale),
    previewUrl: asString(value.preview_url),
  };
}

function normalizeVoice(value: unknown): ElevenLabsVoice | null {
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
        .filter((language): language is ElevenLabsVerifiedLanguage => language !== null)
      : [],
    availableForTiers: normalizeStringArray(voice.available_for_tiers),
    isOwner: asBoolean(voice.is_owner),
    isLegacy: asBoolean(voice.is_legacy),
    isMixed: asBoolean(voice.is_mixed),
    createdAtUnix: asNumber(voice.created_at_unix),
  };
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function extractProviderMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractProviderMessage(item);
      if (message) {
        return message;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ['message', 'detail', 'error', 'msg']) {
    const message = extractProviderMessage(value[key]);
    if (message) {
      return message;
    }
  }

  return null;
}

function errorCodeForStatus(status: number): ElevenLabsErrorCode {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  if (status === 402) {
    return 'quota_exceeded';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 400 || status === 422) {
    return 'invalid_request';
  }
  return 'provider_error';
}

function retryableForStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function messageForProviderError(status: number, providerMessage: string | null): string {
  if (status === 401 || status === 403) {
    return 'ElevenLabs API key was rejected. Check the key in Settings.';
  }
  if (status === 402) {
    return providerMessage ?? 'ElevenLabs quota is exhausted for this account.';
  }
  if (status === 429) {
    return 'ElevenLabs rate limit reached. Try again later.';
  }
  if (providerMessage) {
    return `ElevenLabs request failed: ${providerMessage}`;
  }
  return `ElevenLabs request failed with status ${status}.`;
}

export function isElevenLabsMp3OutputFormat(value: string): value is ElevenLabsMp3OutputFormat {
  return ELEVENLABS_MP3_OUTPUT_FORMATS.includes(value as ElevenLabsMp3OutputFormat);
}

function appendQueryParam(searchParams: URLSearchParams, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined || value === '') {
    return;
  }

  searchParams.set(key, String(value));
}

function normalizeRequestVoiceSettings(settings: ElevenLabsVoiceSettings | undefined): ElevenLabsApiVoiceSettings | undefined {
  if (!settings) {
    return undefined;
  }

  const bodySettings: ElevenLabsApiVoiceSettings = {};

  if (settings.speed !== undefined) {
    bodySettings.speed = settings.speed;
  }
  if (settings.stability !== undefined) {
    bodySettings.stability = settings.stability;
  }
  if (settings.similarityBoost !== undefined) {
    bodySettings.similarity_boost = settings.similarityBoost;
  }
  if (settings.style !== undefined) {
    bodySettings.style = settings.style;
  }
  if (settings.useSpeakerBoost !== undefined) {
    bodySettings.use_speaker_boost = settings.useSpeakerBoost;
  }

  return Object.keys(bodySettings).length > 0 ? bodySettings : undefined;
}

function safeOperationLog(operation: string, error: ElevenLabsServiceError): void {
  log.warn('ElevenLabs request failed', {
    operation,
    code: error.code,
    status: error.status,
    retryable: error.retryable,
  });
}

export class ElevenLabsService {
  private apiKey = '';

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey.trim();
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  async listModels(signal?: AbortSignal): Promise<ElevenLabsModel[]> {
    const response = await this.fetchJson<unknown>(
      '/v1/models',
      {
        method: 'GET',
        headers: this.jsonHeaders(),
        signal,
      },
      'listModels',
    );

    if (!Array.isArray(response)) {
      throw new ElevenLabsServiceError('ElevenLabs returned an invalid models response.', 'invalid_response');
    }

    return response.map(normalizeModel).filter((model): model is ElevenLabsModel => model !== null);
  }

  async listVoices(
    params: ElevenLabsVoiceSearchParams = {},
    signal?: AbortSignal,
  ): Promise<ElevenLabsVoiceSearchResult> {
    const searchParams = new URLSearchParams();
    const pageSize = params.pageSize === undefined
      ? undefined
      : Math.min(100, Math.max(1, Math.floor(params.pageSize)));

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
    const response = await this.fetchJson<ElevenLabsVoicesApiResponse>(
      endpoint,
      {
        method: 'GET',
        headers: this.jsonHeaders(),
        signal,
      },
      'listVoices',
    );

    if (!Array.isArray(response.voices)) {
      throw new ElevenLabsServiceError('ElevenLabs returned an invalid voices response.', 'invalid_response');
    }

    return {
      voices: response.voices.map(normalizeVoice).filter((voice): voice is ElevenLabsVoice => voice !== null),
      hasMore: response.has_more === true,
      totalCount: asNumber(response.total_count),
      nextPageToken: asString(response.next_page_token) ?? null,
    };
  }

  async createSpeech(
    params: ElevenLabsCreateSpeechParams,
    signal?: AbortSignal,
  ): Promise<ElevenLabsSpeechResult> {
    const voiceId = params.voiceId.trim();
    if (!voiceId) {
      throw new ElevenLabsServiceError('Choose an ElevenLabs voice before generating speech.', 'invalid_request');
    }

    if (!params.text.trim()) {
      throw new ElevenLabsServiceError('Enter text to generate speech.', 'invalid_request');
    }

    const outputFormat = params.outputFormat ?? DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT;
    if (!isElevenLabsMp3OutputFormat(outputFormat)) {
      throw new ElevenLabsServiceError(
        `Unsupported ElevenLabs output format. Supported MP3 formats: ${ELEVENLABS_MP3_OUTPUT_FORMATS.join(', ')}.`,
        'unsupported_format',
      );
    }

    const url = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, BASE_URL);
    url.searchParams.set('output_format', outputFormat);

    const body: ElevenLabsSpeechApiRequest = {
      text: params.text,
      model_id: params.modelId?.trim() || 'eleven_multilingual_v2',
    };

    const languageCode = params.languageCode?.trim();
    if (languageCode) {
      body.language_code = languageCode;
    }

    const voiceSettings = normalizeRequestVoiceSettings(params.voiceSettings);
    if (voiceSettings) {
      body.voice_settings = voiceSettings;
    }

    log.debug('Creating ElevenLabs speech', {
      voiceId,
      modelId: body.model_id,
      languageCode: body.language_code,
      outputFormat,
      textLength: params.text.length,
      hasVoiceSettings: Boolean(voiceSettings),
    });

    const response = await this.fetchAudio(
      url,
      {
        method: 'POST',
        headers: {
          ...this.jsonHeaders(),
          Accept: ELEVENLABS_MP3_MIME_TYPE,
        },
        body: JSON.stringify(body),
        signal,
      },
      'createSpeech',
    );

    return {
      audio: response,
      mimeType: ELEVENLABS_MP3_MIME_TYPE,
      extension: ELEVENLABS_MP3_EXTENSION,
      outputFormat,
      size: response.size,
    };
  }

  private jsonHeaders(): HeadersInit {
    const apiKey = this.requireApiKey();
    return {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    };
  }

  private requireApiKey(): string {
    if (!this.hasApiKey()) {
      throw new ElevenLabsServiceError('ElevenLabs API key is not configured.', 'missing_api_key');
    }

    return this.apiKey;
  }

  private async fetchJson<T>(endpoint: string, init: RequestInit, operation: string): Promise<T> {
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, init);
      if (!response.ok) {
        throw await this.providerError(response);
      }

      try {
        return await response.json() as T;
      } catch {
        throw new ElevenLabsServiceError('ElevenLabs returned an invalid JSON response.', 'invalid_response');
      }
    } catch (error) {
      const serviceError = this.normalizeError(error);
      safeOperationLog(operation, serviceError);
      throw serviceError;
    }
  }

  private async fetchAudio(url: URL, init: RequestInit, operation: string): Promise<Blob> {
    try {
      const response = await fetch(url.toString(), init);
      if (!response.ok) {
        throw await this.providerError(response);
      }

      return await response.blob();
    } catch (error) {
      const serviceError = this.normalizeError(error);
      safeOperationLog(operation, serviceError);
      throw serviceError;
    }
  }

  private async providerError(response: Response): Promise<ElevenLabsServiceError> {
    const status = response.status;
    const providerMessage = await this.readProviderMessage(response);
    return new ElevenLabsServiceError(
      messageForProviderError(status, providerMessage),
      errorCodeForStatus(status),
      {
        status,
        retryable: retryableForStatus(status),
      },
    );
  }

  private async readProviderMessage(response: Response): Promise<string | null> {
    let text = '';

    try {
      text = await response.text();
    } catch {
      return null;
    }

    if (!text.trim()) {
      return null;
    }

    try {
      return extractProviderMessage(JSON.parse(text));
    } catch {
      return null;
    }
  }

  private normalizeError(error: unknown): ElevenLabsServiceError {
    if (error instanceof ElevenLabsServiceError) {
      return error;
    }

    if (isAbortError(error)) {
      return new ElevenLabsServiceError('ElevenLabs request was canceled.', 'aborted');
    }

    if (error instanceof TypeError) {
      return new ElevenLabsServiceError('Network error while contacting ElevenLabs.', 'network_error', {
        retryable: true,
      });
    }

    return new ElevenLabsServiceError('Unexpected ElevenLabs request failure.', 'provider_error');
  }
}

export const elevenLabsService = new ElevenLabsService();
