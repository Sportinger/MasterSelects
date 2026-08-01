import type {
  ELEVENLABS_MP3_EXTENSION,
  ELEVENLABS_MP3_MIME_TYPE,
  ElevenLabsMp3OutputFormat,
} from './config';

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

export interface ElevenLabsApiLanguage {
  language_id?: unknown;
  name?: unknown;
}

export interface ElevenLabsApiModel {
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

export interface ElevenLabsApiVoice {
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

export interface ElevenLabsVoicesApiResponse {
  voices?: unknown;
  has_more?: unknown;
  total_count?: unknown;
  next_page_token?: unknown;
}

export interface ElevenLabsApiVoiceSettings {
  speed?: number;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface ElevenLabsSpeechApiRequest {
  text: string;
  model_id?: string;
  language_code?: string;
  voice_settings?: ElevenLabsApiVoiceSettings;
}
