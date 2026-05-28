import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import type {
  FlashBoardComposerReferenceRole,
  FlashBoardMultiShotPrompt,
  FlashBoardSunoVocalGender,
  FlashBoardVoiceSettings,
} from '../../../stores/flashboardStore';
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_SETTINGS,
  DEFAULT_FLASHBOARD_MODEL_VERSION,
  DEFAULT_FLASHBOARD_PROVIDER_ID,
  DEFAULT_FLASHBOARD_SERVICE,
} from '../../../stores/flashboardStore/defaults';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';
import { getExternalDragPayload } from '../../timeline/utils/externalDragSession';
import {
  ELEVENLABS_MP3_OUTPUT_FORMATS,
  elevenLabsService,
  isElevenLabsMp3OutputFormat,
  type ElevenLabsModel,
  type ElevenLabsModelRates,
  type ElevenLabsMp3OutputFormat,
  type ElevenLabsVoice,
} from '../../../services/elevenLabsService';
import {
  checkLemonadeHealth,
  DEFAULT_LEMONADE_MODEL,
  type LemonadeModelInfo,
} from '../../../services/lemonadeProvider';
import { cloudAiService } from '../../../services/cloudAiService';
import {
  DEFAULT_SUNO_AUDIO_WEIGHT,
  DEFAULT_SUNO_CUSTOM_MODE,
  DEFAULT_SUNO_INSTRUMENTAL,
  DEFAULT_SUNO_MODEL_ID,
  DEFAULT_SUNO_STYLE_WEIGHT,
  DEFAULT_SUNO_WEIRDNESS_CONSTRAINT,
  SUNO_MODEL_IDS,
  SUNO_PROVIDER_ID,
} from '../../../services/sunoService';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import { getCatalogEntryPriceEstimate, getFlashBoardPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import {
  getSeedanceReferenceValidationError,
  isSeedance2ProviderId,
} from '../../../services/flashboard/seedanceReferenceRules';
import {
  FLASHBOARD_PROMPT_REFINER_MODEL,
  parseSunoPromptRefinement,
  refineFlashBoardPromptHosted,
  streamRefineFlashBoardPrompt,
} from '../../../services/flashboard/FlashBoardPromptRefiner';
import {
  DEFAULT_FLASHBOARD_CHAT_PROVIDER,
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_TEMPERATURE,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_CHAT_PROVIDERS,
  getFlashBoardChatCreditLabel,
  getOpenAiReasoningEffortOptions,
  isOpenAiReasoningEffortSupported,
  sendFlashBoardChatMessage,
  type FlashBoardChatModelOption,
  type FlashBoardOpenAiReasoningEffort,
  type FlashBoardChatProvider,
} from '../../../services/flashboard/FlashBoardChatService';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { FileTypeIcon } from '../media/FileTypeIcon';

type PopoverType =
  | 'model'
  | 'aspect'
  | 'duration'
  | 'mode'
  | 'imageSize'
  | 'audioModel'
  | 'voice'
  | 'audioOutput'
  | 'voiceSettings'
  | 'sunoModel'
  | 'sunoMode'
  | 'sunoTuning'
  | 'chatProvider'
  | 'chatModel'
  | 'chatTemperature'
  | 'chatReasoning'
  | null;
type NumberVoiceSettingKey = 'speed' | 'stability' | 'similarityBoost' | 'style';
type ModelCategoryId = 'image' | 'video' | 'voice' | 'music';
type ComposerReferenceRoleTarget = FlashBoardComposerReferenceRole;

interface FlashBoardChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  isError?: boolean;
  isPending?: boolean;
}

function createFlashBoardChatMessageId(role: FlashBoardChatMessage['role']): string {
  return `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildFlashBoardChatRequestPrompt(messages: FlashBoardChatMessage[], nextUserPrompt: string): string {
  const previousContext = messages
    .filter((message) => !message.isPending && !message.isError && message.text.trim())
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text.trim()}`)
    .join('\n\n');

  return previousContext ? `${previousContext}\n\nUser: ${nextUserPrompt}` : nextUserPrompt;
}

function normalizeApiKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const INLINE_SUBMENU_POPOVERS = new Set<PopoverType>([
  'model',
  'aspect',
  'duration',
  'imageSize',
  'mode',
  'sunoModel',
  'sunoMode',
  'chatProvider',
  'chatModel',
  'chatTemperature',
  'chatReasoning',
]);

interface ComposerReferenceBadge {
  key: string;
  role: FlashBoardComposerReferenceRole;
  mediaFileId: string;
  mediaType: 'image' | 'video' | 'audio';
  previewUrl?: string;
  roleLabel: string;
  thumbnailUrl?: string;
  displayName: string;
}

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  initialMode?: 'generate' | 'chat';
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

interface SunoPromptSnapshot {
  prompt: string;
  style: string;
  negativeTags: string;
}

const MAX_MULTI_SHOTS = 5;
const MULTI_SHOT_PANEL_EXIT_MS = 190;
const MEDIA_FILE_DRAG_MIME = 'application/x-media-file-id';
const MEDIA_PANEL_ITEM_DRAG_MIME = 'application/x-media-panel-item';
const REFERENCE_AUTO_SCROLL_EDGE_PX = 58;
const REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME = 8;
const MODEL_CATEGORIES: Array<{ id: ModelCategoryId; label: string }> = [
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'voice', label: 'Voice' },
  { id: 'music', label: 'Music' },
];

function isReferenceableMediaType(type: string | undefined): type is 'image' | 'video' | 'audio' {
  return type === 'image' || type === 'video' || type === 'audio';
}

function isInlineSubmenuPopover(type: PopoverType): boolean {
  return INLINE_SUBMENU_POPOVERS.has(type);
}

function renderModelCategoryIcon(categoryId: ModelCategoryId) {
  switch (categoryId) {
    case 'image':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.5" y="3" width="11" height="10" rx="2" />
          <circle cx="6" cy="6.25" r="1.15" />
          <path d="m4 11 3.1-3.1 2 2L10.5 8.5 13 11" />
        </svg>
      );
    case 'video':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2.3" y="4.2" width="8.8" height="7.6" rx="1.7" />
          <path d="m11.1 6.4 2.6-1.45v6.1L11.1 9.6" />
          <path d="M4.4 4.2 5.6 2.5M8.2 4.2 9.4 2.5" />
        </svg>
      );
    case 'voice':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.4a2 2 0 0 0-2 2v3.1a2 2 0 0 0 4 0V4.4a2 2 0 0 0-2-2Z" />
          <path d="M3.8 7.2a4.2 4.2 0 0 0 8.4 0M8 11.4v2.2M5.7 13.6h4.6" />
        </svg>
      );
    case 'music':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.4 2.7v7.2a1.9 1.9 0 1 1-1.2-1.75" />
          <path d="M10.4 3.2 13 4v2.15l-2.6-.8" />
          <circle cx="5.1" cy="11.3" r="1.75" />
        </svg>
      );
    default:
      return null;
  }
}

const ELEVENLABS_OUTPUT_FORMAT_LABELS: Record<ElevenLabsMp3OutputFormat, string> = {
  mp3_44100_128: 'MP3 44.1 kHz / 128 kbps',
  mp3_44100_192: 'MP3 44.1 kHz / 192 kbps',
  mp3_22050_32: 'MP3 22.05 kHz / 32 kbps',
};

const ELEVENLABS_OUTPUT_FORMAT_COMPACT_LABELS: Record<ElevenLabsMp3OutputFormat, string> = {
  mp3_44100_128: 'MP3 128k',
  mp3_44100_192: 'MP3 192k',
  mp3_22050_32: 'MP3 32k',
};

const SUNO_VOCAL_GENDER_LABELS: Record<FlashBoardSunoVocalGender, string> = {
  f: 'Female',
  m: 'Male',
};

const SUNO_MODEL_LABELS: Record<string, string> = {
  V5: 'V5',
  V4_5PLUS: 'V4.5+',
  V4_5: 'V4.5',
  V4: 'V4',
};

interface ElevenLabsModelOption {
  modelId: string;
  name: string;
  description?: string;
  maximumTextLengthPerRequest?: number;
  maxCharactersRequestFreeUser?: number;
  maxCharactersRequestSubscribedUser?: number;
  modelRates?: ElevenLabsModelRates;
}

function getModelCategory(entry: CatalogEntry | undefined): ModelCategoryId {
  if (!entry) {
    return 'video';
  }

  if (entry.service === 'suno' || entry.providerId === SUNO_PROVIDER_ID) {
    return 'music';
  }

  if (entry.service === 'elevenlabs' || (entry.outputType === 'audio' && entry.supportsTextToAudio)) {
    return 'voice';
  }

  if (
    entry.outputType === 'image'
    || (entry.supportsTextToImage && !entry.supportsTextToVideo && !entry.supportsImageToVideo)
  ) {
    return 'image';
  }

  return 'video';
}

function getModelSourceLabel(entry: CatalogEntry): string {
  switch (entry.service) {
    case 'kieai':
      return 'Kie.ai';
    case 'evolink':
      return 'EvoLink';
    case 'piapi':
      return 'PiAPI';
    case 'cloud':
      return 'Cloud';
    case 'elevenlabs':
      return 'ElevenLabs';
    case 'suno':
      return 'Suno';
    default:
      return entry.service;
  }
}

function getProviderDisplayName(entry: CatalogEntry): string {
  if (entry.service === 'elevenlabs') {
    return 'ElevenLabs Speech';
  }

  if (entry.service === 'suno' || entry.providerId === SUNO_PROVIDER_ID) {
    return 'Suno Music';
  }

  return entry.name.replace(' (Kie.ai)', '').replace(' (EvoLink)', '');
}

function clampSunoWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeSunoModel(value: string | undefined): string {
  return value && SUNO_MODEL_IDS.includes(value as typeof SUNO_MODEL_IDS[number])
    ? value
    : DEFAULT_SUNO_MODEL_ID;
}

function getSunoPromptLimit(version: string, customMode: boolean): number {
  if (!customMode) {
    return 500;
  }

  return version === 'V4' ? 3000 : 5000;
}

function getSunoStyleLimit(version: string): number {
  return version === 'V4' ? 200 : 1000;
}

function deriveSunoTitle(prompt: string): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const candidate = firstLine || prompt.trim() || 'Untitled song';
  return candidate.replace(/\s+/g, ' ').slice(0, 80);
}

function normalizeVoiceSettings(settings: FlashBoardVoiceSettings | undefined): Required<FlashBoardVoiceSettings> {
  return {
    ...DEFAULT_ELEVENLABS_VOICE_SETTINGS,
    ...settings,
  };
}

function areVoiceSettingsEqual(
  left: FlashBoardVoiceSettings | undefined,
  right: FlashBoardVoiceSettings | undefined,
): boolean {
  const normalizedLeft = normalizeVoiceSettings(left);
  const normalizedRight = normalizeVoiceSettings(right);

  return normalizedLeft.speed === normalizedRight.speed
    && normalizedLeft.stability === normalizedRight.stability
    && normalizedLeft.similarityBoost === normalizedRight.similarityBoost
    && normalizedLeft.style === normalizedRight.style
    && normalizedLeft.useSpeakerBoost === normalizedRight.useSpeakerBoost;
}

function normalizeElevenLabsOutputFormat(value: string | undefined): ElevenLabsMp3OutputFormat {
  return value && isElevenLabsMp3OutputFormat(value)
    ? value
    : DEFAULT_ELEVENLABS_OUTPUT_FORMAT;
}

function buildElevenLabsModelOptions(models: ElevenLabsModel[]): ElevenLabsModelOption[] {
  if (models.length === 0) {
    return [{
      modelId: DEFAULT_ELEVENLABS_MODEL_ID,
      name: 'Eleven Multilingual v2',
    }];
  }

  return models.map((model) => ({
    modelId: model.modelId,
    name: model.name,
    description: model.description,
    maximumTextLengthPerRequest: model.maximumTextLengthPerRequest,
    maxCharactersRequestFreeUser: model.maxCharactersRequestFreeUser,
    maxCharactersRequestSubscribedUser: model.maxCharactersRequestSubscribedUser,
    modelRates: model.modelRates,
  }));
}

function getModelCharacterLimit(model: ElevenLabsModelOption | undefined): number | null {
  if (!model) {
    return null;
  }

  return model.maximumTextLengthPerRequest
    ?? model.maxCharactersRequestSubscribedUser
    ?? model.maxCharactersRequestFreeUser
    ?? null;
}

function areMultiPromptsEqual(
  left: FlashBoardMultiShotPrompt[],
  right: FlashBoardMultiShotPrompt[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((shot, index) => (
    shot.index === right[index]?.index
    && shot.prompt === right[index]?.prompt
    && shot.duration === right[index]?.duration
  ));
}

function rebalanceMultiPrompts(
  shots: FlashBoardMultiShotPrompt[],
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  const boundedDuration = Math.max(1, Math.floor(totalDuration));
  const limitedShots = shots
    .slice(0, Math.min(MAX_MULTI_SHOTS, boundedDuration))
    .map((shot, index) => ({
      index: index + 1,
      prompt: shot.prompt ?? '',
      duration: Math.max(1, Math.floor(Number(shot.duration) || 1)),
    }));

  if (limitedShots.length === 0) {
    return [];
  }

  let remaining = boundedDuration;

  return limitedShots.map((shot, index) => {
    const remainingShots = limitedShots.length - index - 1;
    const maxForShot = Math.max(1, remaining - remainingShots);
    const nextDuration = index === limitedShots.length - 1
      ? remaining
      : Math.max(1, Math.min(shot.duration, maxForShot));

    remaining -= nextDuration;

    return {
      index: index + 1,
      prompt: shot.prompt,
      duration: nextDuration,
    };
  });
}

function createDefaultMultiPrompts(totalDuration: number): FlashBoardMultiShotPrompt[] {
  const firstShotDuration = Math.max(1, Math.floor(totalDuration / 2));

  return rebalanceMultiPrompts([
    { index: 1, prompt: '', duration: firstShotDuration },
    { index: 2, prompt: '', duration: Math.max(1, totalDuration - firstShotDuration) },
  ], totalDuration);
}

function addMultiPrompt(
  shots: FlashBoardMultiShotPrompt[],
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  const normalized = rebalanceMultiPrompts(shots, totalDuration);
  const maxShots = Math.min(MAX_MULTI_SHOTS, Math.max(1, totalDuration));

  if (normalized.length >= maxShots) {
    return normalized;
  }

  const donorIndex = normalized.reduce((bestIndex, shot, index, collection) => (
    shot.duration > collection[bestIndex].duration ? index : bestIndex
  ), 0);

  if (!normalized[donorIndex] || normalized[donorIndex].duration <= 1) {
    return normalized;
  }

  const next = normalized.map((shot, index) => (
    index === donorIndex
      ? { ...shot, duration: shot.duration - 1 }
      : shot
  ));

  next.push({
    index: next.length + 1,
    prompt: '',
    duration: 1,
  });

  return rebalanceMultiPrompts(next, totalDuration);
}

function removeMultiPrompt(
  shots: FlashBoardMultiShotPrompt[],
  removeIndex: number,
  totalDuration: number,
): FlashBoardMultiShotPrompt[] {
  if (shots.length <= 2) {
    return rebalanceMultiPrompts(shots, totalDuration);
  }

  const removedDuration = shots[removeIndex]?.duration ?? 0;
  const next = shots.filter((_, index) => index !== removeIndex);
  const recipientIndex = Math.max(0, Math.min(removeIndex - 1, next.length - 1));

  if (next[recipientIndex]) {
    next[recipientIndex] = {
      ...next[recipientIndex],
      duration: next[recipientIndex].duration + removedDuration,
    };
  }

  return rebalanceMultiPrompts(next, totalDuration);
}

function buildFallbackPrompt(shots: FlashBoardMultiShotPrompt[]): string {
  return shots
    .map((shot) => shot.prompt.trim())
    .filter(Boolean)
    .join(' / ');
}

function clampReferenceMediaFileIds(referenceMediaFileIds: string[], maxReferenceImages?: number): string[] {
  const uniqueIds = referenceMediaFileIds.filter((mediaFileId, index) => (
    referenceMediaFileIds.indexOf(mediaFileId) === index
  ));
  const hasDuplicates = uniqueIds.length !== referenceMediaFileIds.length;

  if (
    typeof maxReferenceImages !== 'number'
    || !Number.isFinite(maxReferenceImages)
    || maxReferenceImages <= 0
  ) {
    return hasDuplicates ? uniqueIds : referenceMediaFileIds;
  }

  const limitedIds = uniqueIds.slice(0, maxReferenceImages);
  return !hasDuplicates && limitedIds.length === referenceMediaFileIds.length
    ? referenceMediaFileIds
    : limitedIds;
}

function appendReferenceMediaFileIds(currentIds: string[], nextIds: string[]): string[] {
  const seen = new Set(currentIds);
  const result = [...currentIds];

  for (const nextId of nextIds) {
    if (!seen.has(nextId)) {
      seen.add(nextId);
      result.push(nextId);
    }
  }

  return result;
}

function moveMediaFileIdToReferences(currentIds: string[], mediaFileId: string, maxReferenceImages?: number): string[] {
  const nextIds = [...currentIds.filter((id) => id !== mediaFileId), mediaFileId];
  const limitedIds = clampReferenceMediaFileIds(nextIds, maxReferenceImages);

  if (limitedIds.includes(mediaFileId)) {
    return limitedIds;
  }

  return clampReferenceMediaFileIds(
    [mediaFileId, ...currentIds.filter((id) => id !== mediaFileId)],
    maxReferenceImages,
  );
}

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  initialMode = 'generate',
  allowedServices,
  serviceScope,
}: FlashBoardComposerProps) {
  const board = useFlashBoardStore(selectActiveBoard);
  const composer = useFlashBoardStore((s) => s.composer);
  const createDraftNode = useFlashBoardStore((s) => s.createDraftNode);
  const updateNodeRequest = useFlashBoardStore((s) => s.updateNodeRequest);
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const queueNode = useFlashBoardStore((s) => s.queueNode);
  const setHoveredComposerReference = useFlashBoardStore((s) => s.setHoveredComposerReference);
  const mediaFiles = useMediaStore((s) => s.files);
  const openAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.openai));
  const anthropicApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.anthropic));
  const piApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.piapi));
  const kieAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.kieai));
  const evolinkApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.evolink));
  const elevenLabsApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.elevenlabs));
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const useOpenAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.openai && openAiApiKey.trim());
  const useAnthropicKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.anthropic && anthropicApiKey.trim());
  const usePiApiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.piapi && piApiKey.trim());
  const useKieAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.kieai && kieAiApiKey.trim());
  const useEvolinkKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.evolink && evolinkApiKey.trim());
  const useElevenLabsKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.elevenlabs && elevenLabsApiKey.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const hasOpenAiKey = useOpenAiKeyByDefault;
  const hasAnthropicKey = useAnthropicKeyByDefault;
  const hasKieAiKey = useKieAiKeyByDefault;
  const hasEvolinkKey = useEvolinkKeyByDefault;
  const hasElevenLabsKey = useElevenLabsKeyByDefault;
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = accountSession?.authenticated === true;
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseHostedPromptRefiner = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseByoPromptRefiner = !useHostedProductionProviders && hasOpenAiKey;

  const catalog = useMemo(() => getCatalogEntries(), []);
  const cloudFallbackAllowed = !serviceScope && (!allowedServices?.length || allowedServices.includes('cloud'));
  const emptyCatalogFallbackService: CatalogEntry['service'] = cloudFallbackAllowed
    ? 'cloud'
    : serviceScope ?? initialService ?? DEFAULT_FLASHBOARD_SERVICE;
  const visibleCatalog = useMemo(
    () => catalog.filter((entry) => {
      if (serviceScope && entry.service !== serviceScope) {
        return false;
      }
      if (allowedServices?.length && !allowedServices.includes(entry.service)) {
        return false;
      }
      if (entry.service === 'cloud') {
        if (!hasHostedSession) {
          return false;
        }
        if (
          !useHostedProductionProviders
          && (
            entry.providerId === 'cloud-kling'
            || entry.providerId === 'nano-banana-2'
            || entry.providerId === 'bytedance/seedance-2'
            || entry.providerId === 'bytedance/seedance-2-fast'
          )
          && useKieAiKeyByDefault
        ) {
          return false;
        }
        if (!useHostedProductionProviders && entry.providerId === 'cloud-elevenlabs-tts' && useElevenLabsKeyByDefault) {
          return false;
        }
        return true;
      }
      if (useHostedProductionProviders) {
        return false;
      }
      if (entry.service === 'piapi') {
        return usePiApiKeyByDefault;
      }
      if (entry.service === 'kieai') {
        return useKieAiKeyByDefault;
      }
      if (entry.service === 'evolink') {
        return useEvolinkKeyByDefault;
      }
      if (entry.service === 'elevenlabs') {
        return useElevenLabsKeyByDefault;
      }
      if (entry.service === 'suno') {
        return useKieAiKeyByDefault;
      }
      return false;
    }),
    [
      allowedServices,
      catalog,
      hasHostedSession,
      serviceScope,
      useHostedProductionProviders,
      useElevenLabsKeyByDefault,
      useEvolinkKeyByDefault,
      useKieAiKeyByDefault,
      usePiApiKeyByDefault,
    ],
  );
  const modelEntriesByCategory = useMemo(
    () => visibleCatalog.reduce<Record<ModelCategoryId, CatalogEntry[]>>((groups, entry) => {
      groups[getModelCategory(entry)].push(entry);
      return groups;
    }, {
      image: [],
      video: [],
      voice: [],
      music: [],
    }),
    [visibleCatalog],
  );
  const availableModelCategories = useMemo(
    () => MODEL_CATEGORIES.filter((category) => modelEntriesByCategory[category.id].length > 0),
    [modelEntriesByCategory],
  );
  const initialEntry = useMemo(
    () => {
      const explicitService = serviceScope ?? initialService;
      const hasExplicitTarget = Boolean(explicitService || initialProviderId);

      if (hasExplicitTarget) {
        return visibleCatalog.find((entry) => {
          const serviceMatches = !explicitService || explicitService === entry.service;
          const providerMatches = !initialProviderId || entry.providerId === initialProviderId;
          return serviceMatches && providerMatches;
        }) ?? visibleCatalog[0];
      }

      return visibleCatalog.find((entry) => (
        entry.service === DEFAULT_FLASHBOARD_SERVICE
        && entry.providerId === DEFAULT_FLASHBOARD_PROVIDER_ID
      ))
        ?? visibleCatalog.find((entry) => entry.service === 'cloud' && entry.providerId === DEFAULT_FLASHBOARD_PROVIDER_ID)
        ?? visibleCatalog[0];
    },
    [initialProviderId, initialService, serviceScope, visibleCatalog],
  );

  const [popover, setPopover] = useState<PopoverType>(null);
  const [closingPopover, setClosingPopover] = useState<PopoverType>(null);
  const [activeModelCategory, setActiveModelCategory] = useState<ModelCategoryId>(() => getModelCategory(initialEntry));
  const popoverRef = useRef<HTMLDivElement>(null);
  const referenceStripRef = useRef<HTMLDivElement>(null);
  const referencePointerPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const referenceAutoScrollFrameRef = useRef<number | null>(null);
  const referenceAutoScrollVelocityRef = useRef(0);
  const promptRefineAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const copiedChatResetTimeoutRef = useRef<number | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const appliedInitialTargetRef = useRef<string | null>(null);

  const [service, setService] = useState<CatalogEntry['service']>(
    initialEntry?.service ?? visibleCatalog[0]?.service ?? emptyCatalogFallbackService,
  );
  const [providerId, setProviderId] = useState(initialEntry?.providerId ?? visibleCatalog[0]?.providerId ?? initialProviderId ?? '');
  const [version, setVersion] = useState(initialVersion ?? initialEntry?.versions[0] ?? DEFAULT_FLASHBOARD_MODEL_VERSION);
  const [mode, setMode] = useState('std');
  const [prompt, setPrompt] = useState('');
  const [chatPanelOpen, setChatPanelOpen] = useState(initialMode === 'chat');
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatProvider, setChatProvider] = useState<FlashBoardChatProvider>(DEFAULT_FLASHBOARD_CHAT_PROVIDER);
  const [chatModel, setChatModel] = useState(DEFAULT_FLASHBOARD_CHAT_MODEL);
  const [chatTemperature, setChatTemperature] = useState(DEFAULT_FLASHBOARD_CHAT_TEMPERATURE);
  const [openAiReasoningEffort, setOpenAiReasoningEffort] = useState<FlashBoardOpenAiReasoningEffort>(
    DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  );
  const [chatMessages, setChatMessages] = useState<FlashBoardChatMessage[]>([]);
  const [copiedChatMessageId, setCopiedChatMessageId] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatting, setIsChatting] = useState(false);
  const [lemonadeStatus, setLemonadeStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [lemonadeModels, setLemonadeModels] = useState<LemonadeModelInfo[]>([]);
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [multiShots, setMultiShots] = useState(false);
  const [renderMultiShotPanel, setRenderMultiShotPanel] = useState(false);
  const [isMultiShotPanelClosing, setIsMultiShotPanelClosing] = useState(false);
  const [multiPrompt, setMultiPrompt] = useState<FlashBoardMultiShotPrompt[]>([]);
  const [voiceId, setVoiceId] = useState(composer.voiceId ?? '');
  const [voiceName, setVoiceName] = useState(composer.voiceName ?? '');
  const [languageOverride, setLanguageOverride] = useState(composer.languageOverride ?? false);
  const [languageCode, setLanguageCode] = useState(composer.languageCode ?? '');
  const [outputFormat, setOutputFormat] = useState<ElevenLabsMp3OutputFormat>(
    normalizeElevenLabsOutputFormat(composer.outputFormat),
  );
  const [voiceSettings, setVoiceSettings] = useState<Required<FlashBoardVoiceSettings>>(
    () => normalizeVoiceSettings(composer.voiceSettings),
  );
  const [sunoCustomMode, setSunoCustomMode] = useState(composer.sunoCustomMode ?? DEFAULT_SUNO_CUSTOM_MODE);
  const [sunoInstrumental, setSunoInstrumental] = useState(composer.sunoInstrumental ?? DEFAULT_SUNO_INSTRUMENTAL);
  const [sunoStyle, setSunoStyle] = useState(composer.sunoStyle ?? '');
  const [sunoTitle] = useState(composer.sunoTitle ?? '');
  const [sunoNegativeTags, setSunoNegativeTags] = useState(composer.sunoNegativeTags ?? '');
  const [sunoVocalGender, setSunoVocalGender] = useState<FlashBoardSunoVocalGender | ''>(
    composer.sunoVocalGender ?? '',
  );
  const [sunoStyleWeight, setSunoStyleWeight] = useState(
    clampSunoWeight(composer.sunoStyleWeight, DEFAULT_SUNO_STYLE_WEIGHT),
  );
  const [sunoWeirdnessConstraint, setSunoWeirdnessConstraint] = useState(
    clampSunoWeight(composer.sunoWeirdnessConstraint, DEFAULT_SUNO_WEIRDNESS_CONSTRAINT),
  );
  const [sunoAudioWeight, setSunoAudioWeight] = useState(
    clampSunoWeight(composer.sunoAudioWeight, DEFAULT_SUNO_AUDIO_WEIGHT),
  );
  const [elevenLabsModels, setElevenLabsModels] = useState<ElevenLabsModel[]>([]);
  const [isLoadingElevenLabsModels, setIsLoadingElevenLabsModels] = useState(false);
  const [elevenLabsModelsError, setElevenLabsModelsError] = useState<string | null>(null);
  const [voiceSearch, setVoiceSearch] = useState('');
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingElevenLabsVoices, setIsLoadingElevenLabsVoices] = useState(false);
  const [elevenLabsVoicesError, setElevenLabsVoicesError] = useState<string | null>(null);
  const [voiceRefreshNonce, setVoiceRefreshNonce] = useState(0);
  const [isReferenceDragOver, setIsReferenceDragOver] = useState(false);
  const [isRefiningPrompt, setIsRefiningPrompt] = useState(false);
  const [promptRefineError, setPromptRefineError] = useState<string | null>(null);
  const [promptBeforeAiRewrite, setPromptBeforeAiRewrite] = useState<string | null>(null);
  const [sunoBeforeAiRewrite, setSunoBeforeAiRewrite] = useState<SunoPromptSnapshot | null>(null);

  const selectedEntry = useMemo(
    () => visibleCatalog.find((e) => e.service === service && e.providerId === providerId),
    [providerId, service, visibleCatalog],
  );
  const modelButtonLabel = selectedEntry ? getProviderDisplayName(selectedEntry) : 'Model';
  const selectedModelCategory = getModelCategory(selectedEntry);
  const effectiveModelCategory = modelEntriesByCategory[activeModelCategory].length > 0
    ? activeModelCategory
    : availableModelCategories[0]?.id ?? selectedModelCategory;
  const activeModelEntries = modelEntriesByCategory[effectiveModelCategory] ?? [];
  const renderedPopover = popover ?? closingPopover;
  const popoverHostClassName = `fb-pill-group ${closingPopover && !popover ? 'is-closing' : popover ? 'is-opening' : ''}`;
  const inlineSubmenuVisible = isInlineSubmenuPopover(renderedPopover);
  const inlineSubmenuStateClassName = inlineSubmenuVisible
    ? closingPopover && !popover
      ? 'has-inline-submenu is-inline-submenu-closing'
      : 'has-inline-submenu is-inline-submenu-opening'
    : '';
  const isAudioMode = selectedEntry?.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID || service === 'suno';
  const isElevenLabsMode = isAudioMode && !isSunoMode;
  const isHostedAudioMode = isElevenLabsMode && service === 'cloud';
  const elevenLabsModelOptions = useMemo(
    () => buildElevenLabsModelOptions(elevenLabsModels),
    [elevenLabsModels],
  );
  const selectedElevenLabsModel = useMemo(
    () => elevenLabsModelOptions.find((model) => model.modelId === version) ?? elevenLabsModelOptions[0],
    [elevenLabsModelOptions, version],
  );
  const selectedElevenLabsCharacterLimit = getModelCharacterLimit(selectedElevenLabsModel);
  const audioModelButtonLabel = (selectedElevenLabsModel?.name ?? version).replace(/^Eleven\s+/i, '');
  const audioVoiceButtonLabel = voiceName.trim() || voiceId.trim() || 'Voice';
  const audioOutputButtonLabel = ELEVENLABS_OUTPUT_FORMAT_COMPACT_LABELS[outputFormat];
  const voiceSettingsChanged = !areVoiceSettingsEqual(voiceSettings, DEFAULT_ELEVENLABS_VOICE_SETTINGS);
  const sunoModelButtonLabel = SUNO_MODEL_LABELS[version] ?? normalizeSunoModel(version);
  const sunoModeButtonLabel = sunoCustomMode
    ? sunoInstrumental ? 'Custom inst.' : 'Custom song'
    : sunoInstrumental ? 'Simple inst.' : 'Simple song';
  const sunoTuningChanged = sunoStyleWeight !== DEFAULT_SUNO_STYLE_WEIGHT
    || sunoWeirdnessConstraint !== DEFAULT_SUNO_WEIRDNESS_CONSTRAINT
    || sunoAudioWeight !== DEFAULT_SUNO_AUDIO_WEIGHT
    || sunoVocalGender !== '';
  const hasSeedanceAudioReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFiles.find((file) => file.id === mediaFileId)?.type === 'audio'
    )),
    [composer.referenceMediaFileIds, mediaFiles],
  );
  const hasSeedanceVisualReferenceInput = useMemo(
    () => Boolean(composer.startMediaFileId || composer.endMediaFileId)
      || (composer.referenceMediaFileIds ?? []).some((mediaFileId) => {
        const mediaType = mediaFiles.find((file) => file.id === mediaFileId)?.type;
        return mediaType === 'image' || mediaType === 'video';
      }),
    [composer.endMediaFileId, composer.referenceMediaFileIds, composer.startMediaFileId, mediaFiles],
  );
  const seedanceReferenceModeActive = isSeedance2ProviderId(providerId)
    && (composer.referenceMediaFileIds ?? []).length > 0;
  const seedanceReferenceValidationError = getSeedanceReferenceValidationError({
    hasAudioReference: hasSeedanceAudioReferenceInput,
    hasVisualReference: hasSeedanceVisualReferenceInput,
    providerId,
  });
  const supportsAudio = !isAudioMode
    && selectedEntry?.supportsGenerateAudio === true
    && !seedanceReferenceModeActive;
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const normalizedMultiPrompt = useMemo(
    () => rebalanceMultiPrompts(multiPrompt, duration),
    [duration, multiPrompt],
  );
  const effectiveGenerateAudio = !isAudioMode && supportsAudio && (generateAudio || multiShots);
  const effectivePrompt = useMemo(() => {
    const trimmedPrompt = prompt.trim();

    if (trimmedPrompt) {
      return trimmedPrompt;
    }

    if (multiShots) {
      return buildFallbackPrompt(normalizedMultiPrompt);
    }

    return '';
  }, [multiShots, normalizedMultiPrompt, prompt]);
  const effectiveChatPrompt = chatPrompt.trim();
  const chatModelOptions = useMemo<FlashBoardChatModelOption[]>(() => {
    if (chatProvider !== 'lemonade') {
      return FLASHBOARD_CHAT_MODEL_OPTIONS[chatProvider];
    }

    const discoveredModels = lemonadeModels.map((model) => ({
      id: model.id,
      label: model.name || model.id,
      provider: 'lemonade' as const,
      supportsTemperature: true,
    }));
    const fallbackModels = FLASHBOARD_CHAT_MODEL_OPTIONS.lemonade;
    const mergedModels = discoveredModels.length > 0 ? discoveredModels : fallbackModels;

    if (chatModel && !mergedModels.some((model) => model.id === chatModel)) {
      return [
        ...mergedModels,
        {
          id: chatModel,
          label: chatModel === DEFAULT_LEMONADE_MODEL ? 'Lemonade' : chatModel,
          provider: 'lemonade',
          supportsTemperature: true,
        },
      ];
    }

    return mergedModels;
  }, [chatModel, chatProvider, lemonadeModels]);
  const activeChatModel = useMemo(
    () => chatModelOptions.find((model) => model.id === chatModel) ?? chatModelOptions[0],
    [chatModel, chatModelOptions],
  );
  const activeChatModelId = activeChatModel?.id ?? chatModel;
  const chatTemperatureSupported = activeChatModel?.supportsTemperature ?? chatProvider !== 'openai';
  const chatReasoningSupported = chatProvider === 'openai' && isOpenAiReasoningEffortSupported(activeChatModelId);
  const chatReasoningEffortOptions = useMemo(
    () => (chatReasoningSupported ? getOpenAiReasoningEffortOptions(activeChatModelId) : []),
    [activeChatModelId, chatReasoningSupported],
  );
  const chatProviderOptions = useMemo(
    () => useHostedProductionProviders
      ? FLASHBOARD_CHAT_PROVIDERS.filter((provider) => provider.id === 'openai')
      : FLASHBOARD_CHAT_PROVIDERS,
    [useHostedProductionProviders],
  );
  const chatProviderLabel = chatProviderOptions.find((provider) => provider.id === chatProvider)?.label ?? 'Chat';
  const canUseHostedChat = Boolean(chatProvider === 'openai' && accountSession?.authenticated && hostedAIEnabled);
  const canUseByoChat = Boolean(chatProvider === 'openai' && !useHostedProductionProviders && hasOpenAiKey);
  const shouldUseHostedChat = Boolean(canUseHostedChat && (useHostedProductionProviders || !useOpenAiKeyByDefault));
  const chatCreditLabel = chatProvider === 'openai' && (useHostedProductionProviders || !useOpenAiKeyByDefault)
    ? getFlashBoardChatCreditLabel(activeChatModelId)
    : null;
  const chatChargeTitle = chatCreditLabel
    ? `${chatCreditLabel} per hosted model round. Tool follow-up rounds are charged separately.`
    : undefined;
  const chatButtonLabel = isChatting
    ? 'Stop'
    : chatCreditLabel ? `Chat - ${chatCreditLabel}` : 'Chat';
  const multiShotDurationTotal = useMemo(
    () => normalizedMultiPrompt.reduce((sum, shot) => sum + shot.duration, 0),
    [normalizedMultiPrompt],
  );
  const multiShotValidationError = useMemo(() => {
    if (!multiShots) {
      return null;
    }

    if (!supportsMultiShot) {
      return 'Multishot is not available for this model.';
    }

    const maxShots = Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));

    if (normalizedMultiPrompt.length < 2) {
      return 'Add at least 2 shots.';
    }

    if (normalizedMultiPrompt.length > maxShots) {
      return `Use at most ${maxShots} shots for ${duration}s.`;
    }

    if (multiShotDurationTotal !== duration) {
      return `Shot durations must add up to ${duration}s.`;
    }

    const emptyShot = normalizedMultiPrompt.find((shot) => shot.prompt.trim().length === 0);
    if (emptyShot) {
      return `Shot ${emptyShot.index} needs a prompt.`;
    }

    return null;
  }, [duration, multiShotDurationTotal, multiShots, normalizedMultiPrompt, supportsMultiShot]);
  const audioValidationError = useMemo(() => {
    if (!isAudioMode) {
      return null;
    }

    if (isSunoMode) {
      if (service === 'cloud') {
        if (!accountSession?.authenticated) {
          return 'Sign in to use MasterSelects Cloud music.';
        }

        if (!hostedAIEnabled) {
          return 'Enable hosted credits to generate cloud music.';
        }
      } else if (!hasKieAiKey) {
        return 'Add a Kie.ai API key in Settings to generate Suno music.';
      }

      const model = normalizeSunoModel(version);
      const promptLimit = getSunoPromptLimit(model, sunoCustomMode);
      const styleLimit = getSunoStyleLimit(model);

      if (effectivePrompt.length > promptLimit) {
        return `Prompt exceeds the selected Suno limit of ${promptLimit.toLocaleString()} characters.`;
      }

      if (sunoCustomMode) {
        if (!sunoStyle.trim()) {
          return 'Add a Suno style.';
        }

        if (sunoStyle.length > styleLimit) {
          return `Style exceeds the selected Suno limit of ${styleLimit.toLocaleString()} characters.`;
        }
      }

      return null;
    }

    if (isHostedAudioMode) {
      if (!accountSession?.authenticated) {
        return 'Sign in to use MasterSelects Cloud speech.';
      }

      if (!hostedAIEnabled) {
        return 'Enable hosted credits to generate cloud speech.';
      }
    } else if (!hasElevenLabsKey) {
      return 'Add an ElevenLabs API key in Settings to generate speech.';
    }

    if (!voiceId.trim()) {
      return 'Add an ElevenLabs voice ID.';
    }

    if (!version.trim()) {
      return 'Choose an ElevenLabs model.';
    }

    if (languageOverride && !languageCode.trim()) {
      return 'Add a language code or turn language override off.';
    }

    if (
      selectedElevenLabsCharacterLimit !== null
      && effectivePrompt.length > selectedElevenLabsCharacterLimit
    ) {
      return `Text exceeds the selected model limit of ${selectedElevenLabsCharacterLimit.toLocaleString()} characters.`;
    }

    return null;
  }, [
    effectivePrompt.length,
    accountSession?.authenticated,
    hasElevenLabsKey,
    hasKieAiKey,
    hostedAIEnabled,
    isAudioMode,
    isHostedAudioMode,
    isSunoMode,
    languageCode,
    languageOverride,
    selectedElevenLabsCharacterLimit,
    service,
    sunoCustomMode,
    sunoStyle,
    version,
    voiceId,
  ]);
  const backendValidationError = useMemo(() => {
    if (service === 'piapi' && !usePiApiKeyByDefault) {
      return 'Enable a PiAPI key as default in Settings to generate with PiAPI.';
    }

    if (service === 'kieai' && !hasKieAiKey) {
      return 'Enable a Kie.ai key as default in Settings to generate with Kie.ai.';
    }

    if (service === 'evolink' && !hasEvolinkKey) {
      return 'Enable an EvoLink key as default in Settings to generate with EvoLink.';
    }

    if (service === 'suno' && !hasKieAiKey) {
      return 'Enable a Kie.ai key as default in Settings to generate with Suno.';
    }

    if (service === 'cloud' && !isHostedAudioMode && !hasHostedSession) {
      return 'Sign in to use MasterSelects Cloud generation.';
    }

    return null;
  }, [hasEvolinkKey, hasHostedSession, hasKieAiKey, isHostedAudioMode, service, usePiApiKeyByDefault]);
  const hasVideoReferenceInput = useMemo(
    () => (composer.referenceMediaFileIds ?? []).some((mediaFileId) => (
      mediaFiles.find((file) => file.id === mediaFileId)?.type === 'video'
    )),
    [composer.referenceMediaFileIds, mediaFiles],
  );
  const currentPrice = useMemo(() => (
    selectedEntry
      ? getFlashBoardPriceEstimate({
        service,
        providerId,
        outputType: selectedEntry.outputType,
        mode,
        duration,
        imageSize,
        modelId: version,
        modelRates: selectedElevenLabsModel?.modelRates,
        text: effectivePrompt,
        generateAudio: effectiveGenerateAudio,
        multiShots,
        hasVideoInput: hasVideoReferenceInput,
      })
      : null
  ), [
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    selectedElevenLabsModel?.modelRates,
    selectedEntry,
    service,
    version,
  ]);
  const generateActionLabel = isSunoMode ? 'Compose' : isAudioMode ? 'Speak' : 'Generate';
  const generateButtonLabel = currentPrice
    ? `${generateActionLabel} - ${currentPrice.compactLabel}`
    : generateActionLabel;
  const maxReferenceMedia = selectedEntry?.maxReferenceMedia ?? selectedEntry?.maxReferenceImages;
  const effectiveReferenceMediaFileIds = useMemo(
    () => clampReferenceMediaFileIds(composer.referenceMediaFileIds ?? [], maxReferenceMedia),
    [composer.referenceMediaFileIds, maxReferenceMedia],
  );
  const canGenerate = Boolean(board && selectedEntry && effectivePrompt)
    && !multiShotValidationError
    && !audioValidationError
    && !seedanceReferenceValidationError
    && !backendValidationError;
  const canAddShot = multiShots && normalizedMultiPrompt.length < Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));
  const supportsTimelineReferenceRoles = !isAudioMode && selectedEntry?.supportsImageToVideo === true;
  const supportsEndFrameReference = supportsTimelineReferenceRoles && !multiShots;
  const mediaFilesById = useMemo(
    () => new Map(mediaFiles.map((file) => [file.id, file])),
    [mediaFiles],
  );
  const composerReferenceBadges = useMemo<ComposerReferenceBadge[]>(() => {
    const badges: ComposerReferenceBadge[] = [];
    const getBadgeMedia = (mediaFileId: string) => {
      const mediaFile = mediaFilesById.get(mediaFileId);
      return {
        displayName: mediaFile?.name,
        mediaType: isReferenceableMediaType(mediaFile?.type) ? mediaFile.type : 'image',
        previewUrl: mediaFile?.url,
        thumbnailUrl: mediaFile?.thumbnailUrl || (mediaFile?.type === 'image' ? mediaFile.url : undefined),
      };
    };

    if (composer.startMediaFileId) {
      const media = getBadgeMedia(composer.startMediaFileId);
      badges.push({
        key: `start-${composer.startMediaFileId}`,
        role: 'start',
        mediaFileId: composer.startMediaFileId,
        mediaType: media.mediaType,
        previewUrl: media.previewUrl,
        roleLabel: 'IN',
        thumbnailUrl: media.thumbnailUrl,
        displayName: media.displayName ?? 'Start frame',
      });
    }

    if (composer.endMediaFileId) {
      const media = getBadgeMedia(composer.endMediaFileId);
      badges.push({
        key: `end-${composer.endMediaFileId}`,
        role: 'end',
        mediaFileId: composer.endMediaFileId,
        mediaType: media.mediaType,
        previewUrl: media.previewUrl,
        roleLabel: 'OUT',
        thumbnailUrl: media.thumbnailUrl,
        displayName: media.displayName ?? 'End frame',
      });
    }

    effectiveReferenceMediaFileIds.forEach((mediaFileId, index) => {
      const media = getBadgeMedia(mediaFileId);
      badges.push({
        key: `reference-${mediaFileId}`,
        role: 'reference',
        mediaFileId,
        mediaType: media.mediaType,
        previewUrl: media.previewUrl,
        roleLabel: `REF ${index + 1}`,
        thumbnailUrl: media.thumbnailUrl,
        displayName: media.displayName ?? 'Reference media',
      });
    });

    return badges;
  }, [composer.endMediaFileId, composer.startMediaFileId, effectiveReferenceMediaFileIds, mediaFilesById]);
  const hasPromptRefineInput = isSunoMode
    ? Boolean(prompt.trim() || sunoStyle.trim() || sunoNegativeTags.trim())
    : Boolean(prompt.trim() || composerReferenceBadges.length > 0);
  const promptRefineTitle = !canUseHostedPromptRefiner && !canUseByoPromptRefiner
    ? hasHostedSession
      ? 'Enable hosted credits to refine prompts'
      : 'Sign in to refine prompts with MasterSelects Cloud'
    : !hasPromptRefineInput
      ? isSunoMode
        ? 'Add lyrics, style, or a song idea first'
        : 'Add a prompt or reference image first'
      : isSunoMode
        ? `Write Suno lyrics and style with Cloud ${FLASHBOARD_PROMPT_REFINER_MODEL}`
        : `Refine prompt with Cloud ${FLASHBOARD_PROMPT_REFINER_MODEL}`;

  useEffect(() => {
    if (!promptRefineError?.startsWith('Add ')) {
      return;
    }

    if (hasPromptRefineInput) {
      setPromptRefineError(null);
    }
  }, [hasPromptRefineInput, promptRefineError]);

  useEffect(() => {
    if (!initialEntry) {
      return;
    }

    const initialTargetKey = `${initialEntry.service}:${initialEntry.providerId}:${initialVersion ?? ''}`;
    if (appliedInitialTargetRef.current === initialTargetKey) {
      return;
    }
    appliedInitialTargetRef.current = initialTargetKey;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      setService(initialEntry.service);
      setProviderId(initialEntry.providerId);

      const nextVersion =
        initialVersion && initialEntry.versions.includes(initialVersion)
          ? initialVersion
          : initialEntry.versions[0] ?? '';
      setVersion(nextVersion);

      setMode((current) => (
        initialEntry.modes.includes(current) ? current : initialEntry.modes[0] ?? 'std'
      ));
      setDuration((current) => (
        initialEntry.durations.length > 0 && !initialEntry.durations.includes(current)
          ? initialEntry.durations[0] ?? 5
          : current
      ));
      setAspectRatio((current) => (
        initialEntry.aspectRatios.length > 0 && !initialEntry.aspectRatios.includes(current)
          ? initialEntry.aspectRatios[0] ?? '16:9'
          : current
      ));
      if (initialEntry.imageSizes?.length) {
        setImageSize((current) => (
          initialEntry.imageSizes?.includes(current)
            ? current
            : initialEntry.imageSizes?.[0] ?? '1K'
        ));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initialEntry, initialVersion]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if ((isAudioMode || !supportsAudio || selectedEntry.outputType === 'image') && generateAudio) {
        setGenerateAudio(false);
      }

      if ((isAudioMode || !supportsMultiShot || selectedEntry.outputType === 'image') && multiShots) {
        setMultiShots(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [generateAudio, isAudioMode, multiShots, selectedEntry, supportsAudio, supportsMultiShot]);

  useEffect(() => {
    if (!multiShots) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if (!generateAudio) {
        setGenerateAudio(true);
      }

      setMultiPrompt((current) => (
        current.length > 0
          ? rebalanceMultiPrompts(current, duration)
          : createDefaultMultiPrompts(duration)
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [duration, generateAudio, multiShots]);

  useEffect(() => {
    if (multiShots) {
      setRenderMultiShotPanel(true);
      setIsMultiShotPanelClosing(false);
      return;
    }

    if (!renderMultiShotPanel) {
      setIsMultiShotPanelClosing(false);
      return;
    }

    setIsMultiShotPanelClosing(true);
    const timeoutId = window.setTimeout(() => {
      setRenderMultiShotPanel(false);
      setIsMultiShotPanelClosing(false);
      setMultiPrompt([]);
    }, MULTI_SHOT_PANEL_EXIT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [multiShots, renderMultiShotPanel]);

  useEffect(() => {
    if (!selectedEntry) {
      return;
    }

    const nextOutputType = selectedEntry.outputType ?? 'video';
    const nextPatch: Partial<typeof composer> = {};
    const nextComposerMultiPrompt = multiShots ? normalizedMultiPrompt : [];

    if (composer.service !== service) nextPatch.service = service;
    if (composer.providerId !== providerId) nextPatch.providerId = providerId;
    if (composer.version !== version) nextPatch.version = version;
    if (composer.outputType !== nextOutputType) nextPatch.outputType = nextOutputType;
    if (composer.generateAudio !== effectiveGenerateAudio) nextPatch.generateAudio = effectiveGenerateAudio;
    if (composer.multiShots !== multiShots) nextPatch.multiShots = multiShots;
    if (!areMultiPromptsEqual(composer.multiPrompt, nextComposerMultiPrompt)) {
      nextPatch.multiPrompt = nextComposerMultiPrompt;
    }

    if (isElevenLabsMode) {
      const trimmedVoiceId = voiceId.trim();
      const trimmedVoiceName = voiceName.trim();
      const trimmedLanguageCode = languageCode.trim();
      if (composer.voiceId !== trimmedVoiceId) nextPatch.voiceId = trimmedVoiceId;
      if (composer.voiceName !== trimmedVoiceName) nextPatch.voiceName = trimmedVoiceName;
      if (composer.languageOverride !== languageOverride) nextPatch.languageOverride = languageOverride;
      if (composer.languageCode !== trimmedLanguageCode) nextPatch.languageCode = trimmedLanguageCode;
      if (composer.outputFormat !== outputFormat) nextPatch.outputFormat = outputFormat;
      if (!areVoiceSettingsEqual(composer.voiceSettings, voiceSettings)) {
        nextPatch.voiceSettings = { ...voiceSettings };
      }
    }

    if (isSunoMode) {
      const trimmedStyle = sunoStyle.trim();
      const trimmedTitle = sunoTitle.trim();
      const trimmedNegativeTags = sunoNegativeTags.trim();
      if (composer.sunoCustomMode !== sunoCustomMode) nextPatch.sunoCustomMode = sunoCustomMode;
      if (composer.sunoInstrumental !== sunoInstrumental) nextPatch.sunoInstrumental = sunoInstrumental;
      if (composer.sunoStyle !== trimmedStyle) nextPatch.sunoStyle = trimmedStyle;
      if (composer.sunoTitle !== trimmedTitle) nextPatch.sunoTitle = trimmedTitle;
      if (composer.sunoNegativeTags !== trimmedNegativeTags) nextPatch.sunoNegativeTags = trimmedNegativeTags;
      if (composer.sunoVocalGender !== (sunoVocalGender || undefined)) {
        nextPatch.sunoVocalGender = sunoVocalGender || undefined;
      }
      if (composer.sunoStyleWeight !== sunoStyleWeight) nextPatch.sunoStyleWeight = sunoStyleWeight;
      if (composer.sunoWeirdnessConstraint !== sunoWeirdnessConstraint) {
        nextPatch.sunoWeirdnessConstraint = sunoWeirdnessConstraint;
      }
      if (composer.sunoAudioWeight !== sunoAudioWeight) nextPatch.sunoAudioWeight = sunoAudioWeight;
    }

    if (isAudioMode) {
      if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
      if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
    }

    if (!isAudioMode && !selectedEntry.supportsImageToVideo) {
      if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
      if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
    }

    if (!isAudioMode && multiShots && composer.endMediaFileId !== undefined) {
      nextPatch.endMediaFileId = undefined;
    }

    if (
      typeof maxReferenceMedia === 'number'
      && composer.referenceMediaFileIds !== effectiveReferenceMediaFileIds
    ) {
      nextPatch.referenceMediaFileIds = effectiveReferenceMediaFileIds;
    }

    if (Object.keys(nextPatch).length > 0) {
      updateComposer(nextPatch);
    }
  }, [
    composer.endMediaFileId,
    composer.generateAudio,
    composer.languageCode,
    composer.languageOverride,
    composer.multiPrompt,
    composer.multiShots,
    composer.outputFormat,
    composer.outputType,
    composer.providerId,
    composer.referenceMediaFileIds,
    composer.service,
    composer.startMediaFileId,
    composer.sunoAudioWeight,
    composer.sunoCustomMode,
    composer.sunoInstrumental,
    composer.sunoNegativeTags,
    composer.sunoStyle,
    composer.sunoStyleWeight,
    composer.sunoTitle,
    composer.sunoVocalGender,
    composer.sunoWeirdnessConstraint,
    composer.version,
    composer.voiceId,
    composer.voiceName,
    composer.voiceSettings,
    effectiveGenerateAudio,
    effectiveReferenceMediaFileIds,
    isAudioMode,
    isElevenLabsMode,
    isSunoMode,
    languageCode,
    languageOverride,
    maxReferenceMedia,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    providerId,
    selectedEntry,
    service,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    updateComposer,
    version,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  useEffect(() => {
    const canLoadHostedAudio = isHostedAudioMode && hasHostedAudioAccess;
    const canLoadLocalAudio = !isHostedAudioMode && hasElevenLabsKey;

    if (!isElevenLabsMode || (!canLoadHostedAudio && !canLoadLocalAudio)) {
      queueMicrotask(() => {
        setElevenLabsModels([]);
        setElevenLabsModelsError(null);
      });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    if (!isHostedAudioMode) {
      elevenLabsService.setApiKey(elevenLabsApiKey);
    }
    queueMicrotask(() => {
      if (cancelled) return;
      setIsLoadingElevenLabsModels(true);
      setElevenLabsModelsError(null);
    });

    const modelsPromise = isHostedAudioMode
      ? cloudAiService.listElevenLabsModels()
      : elevenLabsService.listModels(controller.signal);

    void modelsPromise
      .then((models) => {
        if (cancelled) return;

        const textToSpeechModels = models.filter((model) => model.canDoTextToSpeech);
        setElevenLabsModels(textToSpeechModels);
        setVersion((current) => (
          textToSpeechModels.some((model) => model.modelId === current)
            ? current
            : textToSpeechModels[0]?.modelId ?? DEFAULT_ELEVENLABS_MODEL_ID
        ));
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Failed to load ElevenLabs models.';
        setElevenLabsModelsError(message);
        setElevenLabsModels([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingElevenLabsModels(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    isElevenLabsMode,
    isHostedAudioMode,
  ]);

  useEffect(() => {
    const canLoadHostedAudio = isHostedAudioMode && hasHostedAudioAccess;
    const canLoadLocalAudio = !isHostedAudioMode && hasElevenLabsKey;

    if (!isElevenLabsMode || (!canLoadHostedAudio && !canLoadLocalAudio)) {
      queueMicrotask(() => {
        setElevenLabsVoices([]);
        setElevenLabsVoicesError(null);
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      if (!isHostedAudioMode) {
        elevenLabsService.setApiKey(elevenLabsApiKey);
      }
      setIsLoadingElevenLabsVoices(true);
      setElevenLabsVoicesError(null);

      const voicesParams = {
        pageSize: 20,
        search: voiceSearch.trim() || undefined,
        sort: 'name',
        sortDirection: 'asc',
      } as const;
      const voicesPromise = isHostedAudioMode
        ? cloudAiService.listElevenLabsVoices(voicesParams)
        : elevenLabsService.listVoices(voicesParams, controller.signal);

      void voicesPromise
        .then((result) => {
          if (controller.signal.aborted) return;
          setElevenLabsVoices(result.voices);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : 'Failed to load ElevenLabs voices.';
          setElevenLabsVoicesError(message);
          setElevenLabsVoices([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingElevenLabsVoices(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    isElevenLabsMode,
    isHostedAudioMode,
    voiceRefreshNonce,
    voiceSearch,
  ]);

  useEffect(() => {
    if (popover === 'model') {
      setActiveModelCategory(selectedModelCategory);
    }
  }, [popover, selectedModelCategory]);

  const closePopover = useCallback((popoverToClose?: PopoverType) => {
    const currentPopover = popoverToClose ?? popover;
    if (!currentPopover) {
      return;
    }

    setClosingPopover(currentPopover);
    setPopover(null);
  }, [popover]);

  useEffect(() => {
    if (!closingPopover || popover) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setClosingPopover(null);
    }, 540);

    return () => window.clearTimeout(timeoutId);
  }, [closingPopover, popover]);

  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [closePopover, popover]);

  useEffect(() => {
    if (chatModelOptions.length === 0) {
      return;
    }

    if (!chatModelOptions.some((model) => model.id === chatModel)) {
      setChatModel(chatModelOptions[0]?.id ?? chatModel);
    }
  }, [chatModel, chatModelOptions]);

  useEffect(() => {
    setChatPanelOpen(initialMode === 'chat');
    setChatError(null);
  }, [initialMode]);

  useEffect(() => {
    if (!chatReasoningSupported || chatReasoningEffortOptions.length === 0) {
      return;
    }

    if (!chatReasoningEffortOptions.some((option) => option.id === openAiReasoningEffort)) {
      setOpenAiReasoningEffort(DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT);
    }
  }, [chatReasoningEffortOptions, chatReasoningSupported, openAiReasoningEffort]);

  useLayoutEffect(() => {
    const historyNode = chatHistoryRef.current;
    if (!historyNode) {
      return;
    }

    historyNode.scrollTop = historyNode.scrollHeight;
  }, [chatError, chatMessages]);

  useEffect(() => {
    if (!chatPanelOpen || chatProvider !== 'lemonade') {
      return;
    }

    let cancelled = false;
    setLemonadeStatus('checking');

    void checkLemonadeHealth(lemonadeEndpoint).then((health) => {
      if (cancelled) {
        return;
      }

      setLemonadeModels(health.models);
      setLemonadeStatus(health.available ? 'online' : 'offline');
    });

    return () => {
      cancelled = true;
    };
  }, [chatPanelOpen, chatProvider, lemonadeEndpoint]);

  const handleChatProviderSelect = useCallback((provider: FlashBoardChatProvider) => {
    setChatProvider(provider);
    setChatError(null);

    const nextDefaultModel = provider === 'lemonade'
      ? lemonadeModels[0]?.id ?? FLASHBOARD_CHAT_MODEL_OPTIONS.lemonade[0]?.id
      : FLASHBOARD_CHAT_MODEL_OPTIONS[provider][0]?.id;

    if (nextDefaultModel) {
      setChatModel(nextDefaultModel);
    }
  }, [lemonadeModels]);

  useEffect(() => {
    if (chatProviderOptions.some((provider) => provider.id === chatProvider)) {
      return;
    }

    const fallbackProvider = chatProviderOptions[0]?.id;
    if (fallbackProvider) {
      handleChatProviderSelect(fallbackProvider);
    }
  }, [chatProvider, chatProviderOptions, handleChatProviderSelect]);

  const handleChatButtonClick = useCallback(async () => {
    closePopover();

    if (!chatPanelOpen) {
      setChatPanelOpen(true);
      setChatError(null);
      return;
    }

    if (isChatting) {
      chatAbortRef.current?.abort();
      return;
    }

    if (!effectiveChatPrompt) {
      setChatError('Write a chat prompt before starting chat.');
      return;
    }

    if (chatProvider === 'openai' && !canUseHostedChat && !canUseByoChat) {
      setChatError(useHostedProductionProviders
        ? 'Sign in and enable hosted credits to use compact chat.'
        : 'Sign in or add an OpenAI API key in Settings to use compact chat.');
      if (useHostedProductionProviders || !hasHostedSession) {
        openAuthDialog();
      } else if (!hostedAIEnabled) {
        openPricingDialog();
      } else {
        openSettings();
      }
      return;
    }

    if (chatProvider === 'anthropic' && !hasAnthropicKey) {
      setChatError('Add an Anthropic API key in Settings to use Claude chat.');
      openSettings();
      return;
    }

    const abortController = new AbortController();
    chatAbortRef.current?.abort();
    chatAbortRef.current = abortController;
    const userMessage: FlashBoardChatMessage = {
      id: createFlashBoardChatMessageId('user'),
      role: 'user',
      text: effectiveChatPrompt,
    };
    const assistantMessageId = createFlashBoardChatMessageId('assistant');
    const requestPrompt = buildFlashBoardChatRequestPrompt(chatMessages, effectiveChatPrompt);

    setIsChatting(true);
    setChatError(null);
    setChatPrompt('');
    setChatMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant',
        text: 'Thinking...',
        isPending: true,
      },
    ]);

    try {
      const response = await sendFlashBoardChatMessage({
        anthropicApiKey,
        hostedAvailable: shouldUseHostedChat,
        lemonadeEndpoint,
        model: activeChatModelId,
        openAiApiKey,
        openAiReasoningEffort,
        prompt: requestPrompt,
        provider: chatProvider,
        signal: abortController.signal,
        temperature: chatTemperature,
      });
      setChatMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, text: response || 'Empty response.', isPending: false }
          : message
      )));
    } catch (error) {
      const errorMessage = abortController.signal.aborted
        ? 'Chat stopped.'
        : error instanceof Error ? error.message : 'Chat request failed.';
      setChatMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, text: errorMessage, isError: true, isPending: false }
          : message
      )));
    } finally {
      if (chatAbortRef.current === abortController) {
        chatAbortRef.current = null;
      }
      setIsChatting(false);
    }
  }, [
    activeChatModelId,
    anthropicApiKey,
    chatMessages,
    chatPanelOpen,
    chatProvider,
    chatTemperature,
    closePopover,
    canUseByoChat,
    canUseHostedChat,
    effectiveChatPrompt,
    hasAnthropicKey,
    hostedAIEnabled,
    hasHostedSession,
    isChatting,
    lemonadeEndpoint,
    openAiApiKey,
    openAiReasoningEffort,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    shouldUseHostedChat,
    useHostedProductionProviders,
  ]);

  const handleClearChatHistory = useCallback(() => {
    closePopover();
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    if (copiedChatResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedChatResetTimeoutRef.current);
      copiedChatResetTimeoutRef.current = null;
    }
    setChatMessages([]);
    setChatPrompt('');
    setChatError(null);
    setCopiedChatMessageId(null);
    setIsChatting(false);
  }, [closePopover]);

  const handleChatMessageDoubleClick = useCallback((message: FlashBoardChatMessage) => {
    if (message.role !== 'assistant' || message.isPending || !message.text.trim()) {
      return;
    }

    if (!navigator.clipboard?.writeText) {
      setChatError('Clipboard is unavailable in this browser.');
      return;
    }

    void navigator.clipboard.writeText(message.text).then(() => {
      setCopiedChatMessageId(message.id);
      if (copiedChatResetTimeoutRef.current !== null) {
        window.clearTimeout(copiedChatResetTimeoutRef.current);
      }
      copiedChatResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedChatMessageId(null);
        copiedChatResetTimeoutRef.current = null;
      }, 1100);
    }).catch(() => {
      setChatError('Could not copy response.');
    });
  }, []);

  const handleChatInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    void handleChatButtonClick();
  }, [handleChatButtonClick]);

  const handleProviderChange = useCallback((newService: CatalogEntry['service'], newId: string) => {
    setService(newService);
    setProviderId(newId);
    const entry = visibleCatalog.find((e) => e.service === newService && e.providerId === newId);
    if (entry) {
      const nextVersion = entry.versions[0] ?? '';
      const nextIsAudio = entry.outputType === 'audio' || entry.service === 'elevenlabs' || entry.service === 'suno';
      const nextIsSuno = entry.service === 'suno' || entry.providerId === SUNO_PROVIDER_ID;
      const nextIsElevenLabs = nextIsAudio && !nextIsSuno;

      setVersion(nextVersion);
      if (!entry.modes.includes(mode)) setMode(entry.modes[0] ?? 'std');
      if (entry.durations.length > 0 && !entry.durations.includes(duration)) setDuration(entry.durations[0] ?? 5);
      if (entry.aspectRatios.length > 0 && !entry.aspectRatios.includes(aspectRatio)) setAspectRatio(entry.aspectRatios[0] ?? '16:9');
      if (entry.imageSizes?.length && !entry.imageSizes.includes(imageSize)) {
        setImageSize(entry.imageSizes[0] ?? '1K');
      }

      updateComposer({
        service: newService,
        providerId: newId,
        version: nextVersion,
        outputType: entry.outputType ?? 'video',
        generateAudio: nextIsAudio ? false : effectiveGenerateAudio,
        multiShots: nextIsAudio ? false : multiShots,
        multiPrompt: nextIsAudio ? [] : normalizedMultiPrompt,
        startMediaFileId: !nextIsAudio && entry.supportsImageToVideo ? composer.startMediaFileId : undefined,
        endMediaFileId: !nextIsAudio && entry.supportsImageToVideo && !multiShots ? composer.endMediaFileId : undefined,
        referenceMediaFileIds: clampReferenceMediaFileIds(
          composer.referenceMediaFileIds,
          entry.maxReferenceMedia ?? entry.maxReferenceImages,
        ),
        voiceId: nextIsElevenLabs ? voiceId.trim() : undefined,
        voiceName: nextIsElevenLabs ? voiceName.trim() : undefined,
        languageOverride: nextIsElevenLabs ? languageOverride : undefined,
        languageCode: nextIsElevenLabs ? languageCode.trim() : undefined,
        outputFormat: nextIsElevenLabs ? outputFormat : undefined,
        voiceSettings: nextIsElevenLabs ? { ...voiceSettings } : undefined,
        sunoCustomMode: nextIsSuno ? sunoCustomMode : undefined,
        sunoInstrumental: nextIsSuno ? sunoInstrumental : undefined,
        sunoStyle: nextIsSuno ? sunoStyle.trim() : undefined,
        sunoTitle: nextIsSuno ? sunoTitle.trim() : undefined,
        sunoNegativeTags: nextIsSuno ? sunoNegativeTags.trim() : undefined,
        sunoVocalGender: nextIsSuno ? sunoVocalGender || undefined : undefined,
        sunoStyleWeight: nextIsSuno ? sunoStyleWeight : undefined,
        sunoWeirdnessConstraint: nextIsSuno ? sunoWeirdnessConstraint : undefined,
        sunoAudioWeight: nextIsSuno ? sunoAudioWeight : undefined,
      });
    }
    closePopover();
  }, [
    aspectRatio,
    closePopover,
    composer.endMediaFileId,
    composer.referenceMediaFileIds,
    composer.startMediaFileId,
    duration,
    effectiveGenerateAudio,
    imageSize,
    languageCode,
    languageOverride,
    mode,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    updateComposer,
    visibleCatalog,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  const handleGenerate = useCallback(() => {
    if (!board || !canGenerate || !selectedEntry) return;

    const node = createDraftNode(board.id);
    const requestIsAudio = selectedEntry.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
    const requestIsSuno = service === 'suno' || providerId === SUNO_PROVIDER_ID;
    const requestIsElevenLabs = requestIsAudio && !requestIsSuno;
    updateNodeRequest(node.id, {
      service,
      providerId,
      version,
      outputType: selectedEntry.outputType ?? 'video',
      mode: requestIsAudio ? undefined : mode,
      prompt: effectivePrompt,
      duration: requestIsAudio ? undefined : duration,
      aspectRatio: requestIsAudio ? undefined : aspectRatio,
      imageSize: !requestIsAudio && selectedEntry.supportsTextToImage ? imageSize : undefined,
      generateAudio: requestIsAudio ? false : effectiveGenerateAudio,
      multiShots: requestIsAudio ? false : multiShots,
      multiPrompt: !requestIsAudio && multiShots ? normalizedMultiPrompt : undefined,
      voiceId: requestIsElevenLabs ? voiceId.trim() : undefined,
      voiceName: requestIsElevenLabs ? voiceName.trim() || undefined : undefined,
      languageOverride: requestIsElevenLabs ? languageOverride : undefined,
      languageCode: requestIsElevenLabs && languageOverride ? languageCode.trim() : undefined,
      outputFormat: requestIsElevenLabs ? outputFormat : undefined,
      voiceSettings: requestIsElevenLabs ? { ...voiceSettings } : undefined,
      sunoCustomMode: requestIsSuno ? sunoCustomMode : undefined,
      sunoInstrumental: requestIsSuno ? sunoInstrumental : undefined,
      sunoStyle: requestIsSuno ? sunoStyle.trim() : undefined,
      sunoTitle: requestIsSuno ? sunoTitle.trim() || deriveSunoTitle(effectivePrompt) : undefined,
      sunoNegativeTags: requestIsSuno ? sunoNegativeTags.trim() || undefined : undefined,
      sunoVocalGender: requestIsSuno ? sunoVocalGender || undefined : undefined,
      sunoStyleWeight: requestIsSuno ? sunoStyleWeight : undefined,
      sunoWeirdnessConstraint: requestIsSuno ? sunoWeirdnessConstraint : undefined,
      sunoAudioWeight: requestIsSuno ? sunoAudioWeight : undefined,
      startMediaFileId: !requestIsAudio && selectedEntry.supportsImageToVideo ? composer.startMediaFileId : undefined,
      endMediaFileId: !requestIsAudio && selectedEntry.supportsImageToVideo && !multiShots ? composer.endMediaFileId : undefined,
      referenceMediaFileIds: requestIsAudio ? [] : effectiveReferenceMediaFileIds,
    });
    queueNode(node.id);
  }, [
    aspectRatio,
    board,
    canGenerate,
    composer.endMediaFileId,
    composer.startMediaFileId,
    createDraftNode,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    effectiveReferenceMediaFileIds,
    imageSize,
    languageCode,
    languageOverride,
    mode,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    providerId,
    queueNode,
    selectedEntry,
    service,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    updateNodeRequest,
    version,
    voiceId,
    voiceName,
    voiceSettings,
  ]);

  const handleRefinePrompt = useCallback(async () => {
    if (isAudioMode && !isSunoMode) {
      return;
    }

    closePopover();

    if (!canUseHostedPromptRefiner && !canUseByoPromptRefiner) {
      if (!hasHostedSession) {
        setPromptRefineError('Sign in to refine prompts with MasterSelects Cloud.');
        openAuthDialog();
      } else if (!hostedAIEnabled) {
        setPromptRefineError('Enable hosted credits to refine prompts.');
        openPricingDialog();
      } else {
        setPromptRefineError('Add an OpenAI API key in Settings to refine prompts.');
        openSettings();
      }
      return;
    }

    if (!selectedEntry) {
      setPromptRefineError('Choose a generation model before refining the prompt.');
      return;
    }

    const hasRefineInput = isSunoMode
      ? Boolean(prompt.trim() || sunoStyle.trim() || sunoNegativeTags.trim())
      : Boolean(prompt.trim() || composerReferenceBadges.length > 0);

    if (!hasRefineInput) {
      setPromptRefineError(isSunoMode ? 'Add lyrics, style, or a song idea first.' : 'Add a prompt or reference image first.');
      return;
    }

    setIsRefiningPrompt(true);
    setPromptRefineError(null);

    const previousPrompt = prompt;
    const previousSunoPrompt: SunoPromptSnapshot = {
      prompt,
      style: sunoStyle,
      negativeTags: sunoNegativeTags,
    };
    let streamedPrompt = '';
    let streamedSunoFields = false;
    promptRefineAbortRef.current?.abort();
    const abortController = new AbortController();
    promptRefineAbortRef.current = abortController;
    setPromptBeforeAiRewrite(previousPrompt);
    setSunoBeforeAiRewrite(isSunoMode ? previousSunoPrompt : null);
    if (isSunoMode) {
      setPrompt('');
      setSunoStyle('');
      setSunoNegativeTags('');
      setSunoCustomMode(true);
    } else {
      setPrompt('');
    }

    try {
      const refinerInput = {
        apiKey: openAiApiKey,
        prompt,
        entry: selectedEntry,
        service,
        providerId,
        version,
        mode,
        duration,
        aspectRatio,
        imageSize,
        generateAudio: effectiveGenerateAudio,
        multiShots,
        sunoStyle,
        sunoNegativeTags,
        sunoInstrumental,
        sunoCustomMode,
        sunoVocalGender: sunoVocalGender || undefined,
        sunoStyleWeight,
        sunoWeirdnessConstraint,
        sunoAudioWeight,
        references: isSunoMode ? [] : composerReferenceBadges.map((badge) => {
          const mediaFile = mediaFilesById.get(badge.mediaFileId);
          return {
            role: badge.role,
            label: badge.role === 'start' ? 'START' : badge.role === 'end' ? 'END' : badge.roleLabel,
            displayName: badge.displayName,
            mediaType: mediaFile?.type ?? badge.mediaType,
            file: mediaFile?.file,
            url: badge.previewUrl ?? mediaFile?.url,
            thumbnailUrl: badge.thumbnailUrl,
          };
        }),
      };

      const refinedPrompt = canUseHostedPromptRefiner
        ? await refineFlashBoardPromptHosted(refinerInput, {
          signal: abortController.signal,
        })
        : await streamRefineFlashBoardPrompt(refinerInput, {
          signal: abortController.signal,
          onDelta: (_delta, fullText) => {
            streamedPrompt = fullText;
            if (isSunoMode) {
              const parsed = parseSunoPromptRefinement(fullText);
              if (parsed.lyrics !== undefined) {
                setPrompt(parsed.lyrics);
                streamedSunoFields = true;
              }
              if (parsed.style !== undefined) {
                setSunoStyle(parsed.style);
                streamedSunoFields = true;
              }
              if (parsed.negativeTags !== undefined) {
                setSunoNegativeTags(parsed.negativeTags);
                streamedSunoFields = true;
              }
            } else {
              setPrompt(fullText);
            }
          },
        });

      if (isSunoMode) {
        const parsed = parseSunoPromptRefinement(refinedPrompt);
        if (parsed.lyrics || parsed.style || parsed.negativeTags) {
          setPrompt(parsed.lyrics ?? '');
          setSunoStyle(parsed.style ?? '');
          setSunoNegativeTags(parsed.negativeTags ?? '');
          setSunoCustomMode(true);
        } else {
          setPrompt(refinedPrompt);
        }
      } else {
        setPrompt(refinedPrompt);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      if (isSunoMode && (!streamedPrompt.trim() || !streamedSunoFields)) {
        setPrompt(previousSunoPrompt.prompt);
        setSunoStyle(previousSunoPrompt.style);
        setSunoNegativeTags(previousSunoPrompt.negativeTags);
      } else if (!streamedPrompt.trim()) {
        setPrompt(previousPrompt);
      }
      setPromptRefineError(error instanceof Error ? error.message : 'Failed to refine prompt.');
    } finally {
      if (promptRefineAbortRef.current === abortController) {
        promptRefineAbortRef.current = null;
      }
      setIsRefiningPrompt(false);
    }
  }, [
    aspectRatio,
    closePopover,
    composerReferenceBadges,
    canUseByoPromptRefiner,
    canUseHostedPromptRefiner,
    duration,
    effectiveGenerateAudio,
    hasHostedSession,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isSunoMode,
    mediaFilesById,
    mode,
    multiShots,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    prompt,
    providerId,
    selectedEntry,
    service,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  ]);

  const handleRestorePromptBeforeAiRewrite = useCallback(() => {
    if (promptBeforeAiRewrite === null && sunoBeforeAiRewrite === null) {
      return;
    }

    promptRefineAbortRef.current?.abort();
    if (isSunoMode && sunoBeforeAiRewrite) {
      setPrompt(sunoBeforeAiRewrite.prompt);
      setSunoStyle(sunoBeforeAiRewrite.style);
      setSunoNegativeTags(sunoBeforeAiRewrite.negativeTags);
    } else if (promptBeforeAiRewrite !== null) {
      setPrompt(promptBeforeAiRewrite);
    }
    setPromptBeforeAiRewrite(null);
    setSunoBeforeAiRewrite(null);
    setPromptRefineError(null);
  }, [isSunoMode, promptBeforeAiRewrite, sunoBeforeAiRewrite]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (chatPanelOpen) {
      return;
    }

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [chatPanelOpen, handleGenerate]);

  const togglePopover = useCallback((type: PopoverType) => {
    if (!type) {
      closePopover();
      return;
    }

    if (popover === type) {
      closePopover(type);
      return;
    }

    setClosingPopover(null);
    setPopover(type);
  }, [closePopover, popover]);

  const handleAudioToggle = useCallback(() => {
    if (!supportsAudio || multiShots) {
      return;
    }

    setGenerateAudio((current) => !current);
  }, [multiShots, supportsAudio]);

  const handleMultiShotToggle = useCallback(() => {
    if (!supportsMultiShot) {
      return;
    }

    setMultiShots((current) => {
      const next = !current;

      if (next) {
        setGenerateAudio(true);
        setMultiPrompt((existing) => (
          existing.length > 0
            ? rebalanceMultiPrompts(existing, duration)
            : createDefaultMultiPrompts(duration)
        ));
      }

      return next;
    });
  }, [duration, supportsMultiShot]);

  const handleShotPromptChange = useCallback((index: number, value: string) => {
    setMultiPrompt((current) => current.map((shot, shotIndex) => (
      shotIndex === index ? { ...shot, prompt: value } : shot
    )));
  }, []);

  const handleShotDurationChange = useCallback((index: number, value: string) => {
    const nextDuration = Math.max(1, Math.floor(Number(value) || 1));
    setMultiPrompt((current) => rebalanceMultiPrompts(
      current.map((shot, shotIndex) => (
        shotIndex === index ? { ...shot, duration: nextDuration } : shot
      )),
      duration,
    ));
  }, [duration]);

  const handleAddShot = useCallback(() => {
    setMultiPrompt((current) => addMultiPrompt(current, duration));
  }, [duration]);

  const handleRemoveShot = useCallback((index: number) => {
    setMultiPrompt((current) => removeMultiPrompt(current, index, duration));
  }, [duration]);

  const handleRemoveComposerReference = useCallback((badge: ComposerReferenceBadge) => {
    setHoveredComposerReference(null);
    if (badge.role === 'start') {
      updateComposer({ startMediaFileId: undefined });
      return;
    }

    if (badge.role === 'end') {
      updateComposer({ endMediaFileId: undefined });
      return;
    }

    updateComposer({
      referenceMediaFileIds: effectiveReferenceMediaFileIds.filter((id) => id !== badge.mediaFileId),
    });
  }, [effectiveReferenceMediaFileIds, setHoveredComposerReference, updateComposer]);

  const handleComposerReferenceRoleChange = useCallback((
    badge: ComposerReferenceBadge,
    role: ComposerReferenceRoleTarget,
  ) => {
    if (role !== 'reference' && !supportsTimelineReferenceRoles) {
      return;
    }

    if (role === 'end' && !supportsEndFrameReference) {
      return;
    }

    const mediaFileId = badge.mediaFileId;
    let nextReferenceMediaFileIds = effectiveReferenceMediaFileIds.filter((id) => id !== mediaFileId);
    const patch: Partial<typeof composer> = {};

    if (role === 'reference') {
      nextReferenceMediaFileIds = moveMediaFileIdToReferences(
        nextReferenceMediaFileIds,
        mediaFileId,
        maxReferenceMedia,
      );

      if (composer.startMediaFileId === mediaFileId) {
        patch.startMediaFileId = undefined;
      }
      if (composer.endMediaFileId === mediaFileId) {
        patch.endMediaFileId = undefined;
      }
    } else if (role === 'start') {
      if (composer.startMediaFileId && composer.startMediaFileId !== mediaFileId) {
        nextReferenceMediaFileIds = moveMediaFileIdToReferences(
          nextReferenceMediaFileIds,
          composer.startMediaFileId,
          maxReferenceMedia,
        );
      }

      patch.startMediaFileId = mediaFileId;
      if (composer.endMediaFileId === mediaFileId) {
        patch.endMediaFileId = undefined;
      }
    } else {
      if (composer.endMediaFileId && composer.endMediaFileId !== mediaFileId) {
        nextReferenceMediaFileIds = moveMediaFileIdToReferences(
          nextReferenceMediaFileIds,
          composer.endMediaFileId,
          maxReferenceMedia,
        );
      }

      patch.endMediaFileId = mediaFileId;
      if (composer.startMediaFileId === mediaFileId) {
        patch.startMediaFileId = undefined;
      }
    }

    updateComposer({
      ...patch,
      referenceMediaFileIds: clampReferenceMediaFileIds(nextReferenceMediaFileIds, maxReferenceMedia),
    });

    setHoveredComposerReference({ mediaFileId, role });
  }, [
    composer.endMediaFileId,
    composer.startMediaFileId,
    effectiveReferenceMediaFileIds,
    maxReferenceMedia,
    setHoveredComposerReference,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateComposer,
  ]);

  const applyReferenceCardFocus = useCallback((strip: HTMLDivElement, clientX: number, clientY: number) => {
    const cards = strip.querySelectorAll<HTMLElement>('.fb-reference-card');

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const normalizedX = (clientX - centerX) / Math.max(1, rect.width * 0.82);
      const normalizedY = (clientY - centerY) / Math.max(1, rect.height * 0.82);
      const distance = Math.hypot(normalizedX, normalizedY);
      const focus = Math.max(0, 1 - distance);
      const easedFocus = Math.pow(focus, 1.35);

      card.style.setProperty('--fb-reference-focus', easedFocus.toFixed(3));
      card.style.zIndex = easedFocus > 0 ? String(10 + Math.round(easedFocus * 90)) : '';
    });
  }, []);

  const stopReferenceAutoScroll = useCallback(() => {
    referenceAutoScrollVelocityRef.current = 0;

    if (referenceAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(referenceAutoScrollFrameRef.current);
      referenceAutoScrollFrameRef.current = null;
    }
  }, []);

  const ensureReferenceAutoScroll = useCallback(() => {
    if (referenceAutoScrollFrameRef.current !== null) {
      return;
    }

    const tick = () => {
      const strip = referenceStripRef.current;
      const velocity = referenceAutoScrollVelocityRef.current;

      if (!strip || Math.abs(velocity) < 0.1) {
        referenceAutoScrollFrameRef.current = null;
        referenceAutoScrollVelocityRef.current = 0;
        return;
      }

      const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, strip.scrollLeft + velocity));

      if (nextScrollLeft === strip.scrollLeft) {
        referenceAutoScrollFrameRef.current = null;
        referenceAutoScrollVelocityRef.current = 0;
        return;
      }

      strip.scrollLeft = nextScrollLeft;

      const pointerPosition = referencePointerPositionRef.current;
      if (pointerPosition) {
        applyReferenceCardFocus(strip, pointerPosition.clientX, pointerPosition.clientY);
      }

      referenceAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    referenceAutoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [applyReferenceCardFocus]);

  const updateReferenceAutoScroll = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const strip = event.currentTarget;
    const computedStyle = window.getComputedStyle(strip);
    const isVerticalStrip = computedStyle.flexDirection === 'column' || computedStyle.overflowX === 'hidden';
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);

    if (isVerticalStrip || maxScrollLeft <= 1) {
      stopReferenceAutoScroll();
      return;
    }

    const rect = strip.getBoundingClientRect();
    const edgeSize = Math.min(REFERENCE_AUTO_SCROLL_EDGE_PX, Math.max(32, rect.width * 0.22));
    const leftDistance = event.clientX - rect.left;
    const rightDistance = rect.right - event.clientX;
    let velocity = 0;

    if (leftDistance < edgeSize) {
      const strength = Math.max(0, Math.min(1, (edgeSize - leftDistance) / edgeSize));
      velocity = -REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME * Math.pow(strength, 1.35);
    } else if (rightDistance < edgeSize) {
      const strength = Math.max(0, Math.min(1, (edgeSize - rightDistance) / edgeSize));
      velocity = REFERENCE_AUTO_SCROLL_MAX_PX_PER_FRAME * Math.pow(strength, 1.35);
    }

    if ((velocity < 0 && strip.scrollLeft <= 0) || (velocity > 0 && strip.scrollLeft >= maxScrollLeft - 1)) {
      velocity = 0;
    }

    referenceAutoScrollVelocityRef.current = velocity;

    if (velocity === 0) {
      stopReferenceAutoScroll();
    } else {
      ensureReferenceAutoScroll();
    }
  }, [ensureReferenceAutoScroll, stopReferenceAutoScroll]);

  const updateReferenceCardFocus = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    referencePointerPositionRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };

    applyReferenceCardFocus(event.currentTarget, event.clientX, event.clientY);
    updateReferenceAutoScroll(event);
  }, [applyReferenceCardFocus, updateReferenceAutoScroll]);

  const resetReferenceCardFocus = useCallback((event?: React.PointerEvent<HTMLDivElement>) => {
    referencePointerPositionRef.current = null;
    const strip = event?.currentTarget ?? referenceStripRef.current;
    if (!strip) {
      return;
    }

    strip.querySelectorAll<HTMLElement>('.fb-reference-card').forEach((card) => {
      card.style.setProperty('--fb-reference-focus', '0');
      card.style.zIndex = '';
    });
  }, []);

  const handleReferenceStripPointerLeave = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    resetReferenceCardFocus(event);
    stopReferenceAutoScroll();
  }, [resetReferenceCardFocus, stopReferenceAutoScroll]);

  useEffect(() => () => {
    stopReferenceAutoScroll();
  }, [stopReferenceAutoScroll]);

  useEffect(() => () => {
    promptRefineAbortRef.current?.abort();
    chatAbortRef.current?.abort();
    if (copiedChatResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedChatResetTimeoutRef.current);
    }
  }, []);

  const resizePromptInput = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = Number.parseFloat(computedStyle.minHeight);
    const maxHeight = Number.parseFloat(computedStyle.maxHeight);
    const lowerBound = Number.isFinite(minHeight) ? minHeight : 0;
    const upperBound = Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight;
    const nextHeight = Math.ceil(Math.max(lowerBound, Math.min(textarea.scrollHeight, upperBound)));

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizePromptInput(chatPanelOpen ? chatInputRef.current : promptInputRef.current);
  }, [chatPanelOpen, chatPrompt, isAudioMode, multiShots, prompt, resizePromptInput]);

  const getReferenceMediaFileIdsFromTransfer = useCallback((dataTransfer: DataTransfer): string[] => {
    const externalDragPayload = getExternalDragPayload();
    const ids = [
      dataTransfer.getData(MEDIA_FILE_DRAG_MIME),
      dataTransfer.getData(MEDIA_PANEL_ITEM_DRAG_MIME),
      externalDragPayload?.kind === 'media-file' ? externalDragPayload.id : '',
    ].filter(Boolean);

    return ids.filter((id, index) => {
      if (ids.indexOf(id) !== index) {
        return false;
      }
      const mediaFile = mediaFilesById.get(id);
      return isReferenceableMediaType(mediaFile?.type);
    });
  }, [mediaFilesById]);

  const hasReferenceDragType = useCallback((dataTransfer: DataTransfer): boolean => (
    dataTransfer.types.includes(MEDIA_FILE_DRAG_MIME)
    || dataTransfer.types.includes(MEDIA_PANEL_ITEM_DRAG_MIME)
    || getExternalDragPayload()?.kind === 'media-file'
  ), []);

  const handleReferenceDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsReferenceDragOver(true);
  }, [hasReferenceDragType]);

  const handleReferenceDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsReferenceDragOver(false);
    }
  }, []);

  const handleReferenceDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasReferenceDragType(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsReferenceDragOver(false);

    const droppedIds = getReferenceMediaFileIdsFromTransfer(event.dataTransfer);
    if (droppedIds.length === 0) {
      return;
    }

    const currentReferences = useFlashBoardStore.getState().composer.referenceMediaFileIds ?? [];
    updateComposer({
      referenceMediaFileIds: clampReferenceMediaFileIds(
        appendReferenceMediaFileIds(currentReferences, droppedIds),
        maxReferenceMedia,
      ),
    });
  }, [
    getReferenceMediaFileIdsFromTransfer,
    hasReferenceDragType,
    maxReferenceMedia,
    updateComposer,
  ]);

  const handleSelectVoice = useCallback((voice: ElevenLabsVoice) => {
    setVoiceId(voice.voiceId);
    setVoiceName(voice.name);
  }, []);

  const handlePreviewVoice = useCallback((previewUrl: string | undefined) => {
    if (!previewUrl) {
      return;
    }

    const audio = new Audio(previewUrl);
    audio.preload = 'none';
    void audio.play().catch(() => undefined);
  }, []);

  const handleVoiceSettingNumberChange = useCallback((key: NumberVoiceSettingKey, value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    setVoiceSettings((current) => ({
      ...current,
      [key]: nextValue,
    }));
  }, []);

  const resetVoiceSettings = useCallback(() => {
    setVoiceSettings({ ...DEFAULT_ELEVENLABS_VOICE_SETTINGS });
  }, []);

  const resetSunoTuning = useCallback(() => {
    setSunoVocalGender('');
    setSunoStyleWeight(DEFAULT_SUNO_STYLE_WEIGHT);
    setSunoWeirdnessConstraint(DEFAULT_SUNO_WEIRDNESS_CONSTRAINT);
    setSunoAudioWeight(DEFAULT_SUNO_AUDIO_WEIGHT);
  }, []);

  if (!board) return null;

  const showComposerReferences = composerReferenceBadges.length > 0;
  const composerStyle = showComposerReferences
    ? ({ '--fb-reference-strip-width': `${Math.max(80, composerReferenceBadges.length * 80 + 4)}px` } as CSSProperties)
    : undefined;
  const showChatCloudActions = Boolean(chatError && !hasHostedSession && /sign in/i.test(chatError));
  const showGenerationCloudActions = Boolean(backendValidationError && service === 'cloud' && /sign in/i.test(backendValidationError));

  return (
    <div
      className={`fb-bubble ${showComposerReferences ? 'has-references' : ''} ${chatPanelOpen ? 'has-chat-panel' : ''} ${isReferenceDragOver ? 'reference-drop-active' : ''} ${isRefiningPrompt ? 'is-refining-prompt' : ''}`}
      style={composerStyle}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={handleReferenceDragOver}
      onDragLeave={handleReferenceDragLeave}
      onDrop={handleReferenceDrop}
    >
      {chatPanelOpen && (chatMessages.length > 0 || chatError) && (
        <div className="fb-chat-output" ref={chatHistoryRef} role="log" aria-live="polite">
          {chatMessages.map((message) => {
            const canCopy = message.role === 'assistant' && !message.isPending && !message.isError && Boolean(message.text.trim());
            const copied = copiedChatMessageId === message.id;

            return (
              <div
                key={message.id}
                className={`fb-chat-message ${message.role} ${message.isPending ? 'is-pending' : ''} ${message.isError ? 'is-error' : ''} ${canCopy ? 'is-copyable' : ''} ${copied ? 'is-copied' : ''}`}
                onDoubleClick={() => handleChatMessageDoubleClick(message)}
                title={canCopy ? 'Double-click to copy response' : undefined}
              >
                <div className="fb-chat-output-label">
                  {message.role === 'user' ? 'You' : copied ? 'Copied' : message.isError ? 'Error' : 'AI'}
                </div>
                <div className="fb-chat-output-message">{message.text}</div>
              </div>
            );
          })}
          {chatError && (
            <div className={`fb-chat-message assistant is-error ${showChatCloudActions ? 'has-cloud-actions' : ''}`}>
              <div className="fb-chat-output-label">Error</div>
              <div className="fb-chat-output-message">{chatError}</div>
              {showChatCloudActions && (
                <div className="fb-chat-error-actions">
                  <button type="button" onClick={openPricingDialog}>
                    Prices
                  </button>
                  <button type="button" onClick={openAuthDialog}>
                    Sign in
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className={`fb-bubble-main ${showComposerReferences ? 'has-references' : ''}`}>
        {showComposerReferences && (
          <div
            ref={referenceStripRef}
            className={`fb-reference-strip ${composerReferenceBadges.length <= 3 ? 'is-loose' : ''}`}
            aria-label="AI prompt references"
            onPointerMove={updateReferenceCardFocus}
            onPointerLeave={handleReferenceStripPointerLeave}
          >
            {composerReferenceBadges.map((badge) => (
              <div
                key={badge.key}
                className={`fb-reference-card ${badge.role} ${badge.mediaType}`}
                title={badge.displayName}
                onMouseEnter={() => setHoveredComposerReference({ mediaFileId: badge.mediaFileId, role: badge.role })}
                onMouseLeave={() => setHoveredComposerReference(null)}
              >
                <span className="fb-reference-number">{badge.roleLabel.replace('REF ', '')}</span>
                <button
                  className="fb-reference-remove"
                  type="button"
                  onClick={() => handleRemoveComposerReference(badge)}
                  title={`Remove ${badge.roleLabel}`}
                >
                  &times;
                </button>
                {supportsTimelineReferenceRoles && (
                  <div className="fb-reference-role-actions" aria-label={`Role for ${badge.displayName}`}>
                    <button
                      className={`fb-reference-role-button ${badge.role === 'start' ? 'active' : ''}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleComposerReferenceRoleChange(badge, 'start');
                      }}
                      title="Use as start frame"
                      aria-pressed={badge.role === 'start'}
                    >
                      IN
                    </button>
                    <button
                      className={`fb-reference-role-button ${badge.role === 'reference' ? 'active' : ''}`}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleComposerReferenceRoleChange(badge, 'reference');
                      }}
                      title="Use as regular reference"
                      aria-pressed={badge.role === 'reference'}
                    >
                      REF
                    </button>
                    <button
                      className={`fb-reference-role-button ${badge.role === 'end' ? 'active' : ''}`}
                      type="button"
                      disabled={!supportsEndFrameReference}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleComposerReferenceRoleChange(badge, 'end');
                      }}
                      title={supportsEndFrameReference ? 'Use as end frame' : 'End frames are unavailable in multi-shot mode'}
                      aria-pressed={badge.role === 'end'}
                    >
                      OUT
                    </button>
                  </div>
                )}
                <div className="fb-reference-preview">
                  {badge.thumbnailUrl ? (
                    <img src={badge.thumbnailUrl} alt="" draggable={false} />
                  ) : badge.mediaType === 'video' && badge.previewUrl ? (
                    <video src={badge.previewUrl} muted playsInline preload="metadata" />
                  ) : (
                    <div className="fb-reference-placeholder">
                      <FileTypeIcon type={badge.mediaType} large />
                    </div>
                  )}
                </div>
                <div className="fb-reference-name">{badge.displayName}</div>
              </div>
            ))}
          </div>
        )}

        {chatPanelOpen ? (
          <div className="fb-bubble-prompt fb-chat-prompt-window">
            <div className="fb-bubble-row">
              <textarea
                ref={chatInputRef}
                className="fb-bubble-input fb-chat-input"
                value={chatPrompt}
                onInput={(event) => resizePromptInput(event.currentTarget)}
                onKeyDown={handleChatInputKeyDown}
                onChange={(event) => {
                  setChatPrompt(event.target.value);
                  setChatError(null);
                }}
                placeholder="Ask about the prompt, model choice, or next variation..."
                rows={3}
              />
              <button
                className="fb-bubble-close"
                type="button"
                onClick={() => {
                  setChatPrompt('');
                  setChatError(null);
                }}
                title="Clear chat prompt"
              >
                &times;
              </button>
            </div>
          </div>
        ) : (
        <div className={`fb-bubble-prompt ${isRefiningPrompt ? 'is-refining' : ''}`}>
          <div className={`fb-bubble-row ${isSunoMode ? 'fb-bubble-row-suno' : ''}`}>
            {isSunoMode ? (
              <div className="fb-suno-prompt-grid">
                <label className="fb-suno-prompt-field fb-suno-prompt-field-lyrics">
                  <span>Lyrics</span>
                  <textarea
                    ref={promptInputRef}
                    className="fb-bubble-input fb-suno-input fb-suno-lyrics-input"
                    value={prompt}
                    onInput={(event) => resizePromptInput(event.currentTarget)}
                    onChange={(e) => {
                      setPrompt(e.target.value);
                      setPromptRefineError(null);
                    }}
                    placeholder="Lyrics, song idea, mood, or background music..."
                    rows={3}
                  />
                </label>
                <label className="fb-suno-prompt-field">
                  <span>Style</span>
                  <textarea
                    className="fb-bubble-input fb-suno-input"
                    value={sunoStyle}
                    onChange={(e) => {
                      setSunoStyle(e.target.value);
                      setPromptRefineError(null);
                      if (e.target.value.trim()) {
                        setSunoCustomMode(true);
                      }
                    }}
                    placeholder="cinematic synthwave, ambient piano..."
                    maxLength={getSunoStyleLimit(version)}
                    rows={2}
                  />
                </label>
                <label className="fb-suno-prompt-field">
                  <span>Negative</span>
                  <textarea
                    className="fb-bubble-input fb-suno-input"
                    value={sunoNegativeTags}
                    onChange={(e) => {
                      setSunoNegativeTags(e.target.value);
                      setPromptRefineError(null);
                    }}
                    placeholder="distorted vocals, harsh noise..."
                    maxLength={500}
                    rows={2}
                  />
                </label>
              </div>
            ) : (
              <textarea
                ref={promptInputRef}
                className="fb-bubble-input"
                value={prompt}
                onInput={(event) => resizePromptInput(event.currentTarget)}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setPromptRefineError(null);
                }}
                placeholder={
                  isAudioMode
                    ? 'Text to speak...'
                    : multiShots
                      ? 'Overall scene or style (optional when using multishot)...'
                      : 'Describe what to generate...'
                }
                rows={isAudioMode ? 2 : multiShots ? 3 : 2}
              />
            )}
            {(promptBeforeAiRewrite !== null || sunoBeforeAiRewrite !== null) && (
              <button
                className="fb-bubble-rewind"
                type="button"
                onClick={handleRestorePromptBeforeAiRewrite}
                title="Restore prompt before AI rewrite"
                aria-label="Restore prompt before AI rewrite"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M6.2 4.1H2.8V.8" />
                  <path d="M3 4.1A6 6 0 1 1 2.2 9" />
                  <path d="M8 5.2v3.1l2.1 1.2" />
                </svg>
              </button>
            )}
            <button
              className="fb-bubble-close"
              type="button"
              onClick={() => {
                setPrompt('');
                if (isSunoMode) {
                  setSunoStyle('');
                  setSunoNegativeTags('');
                }
                setPromptBeforeAiRewrite(null);
                setSunoBeforeAiRewrite(null);
                setPromptRefineError(null);
              }}
              title="Clear"
            >
              &times;
            </button>
          </div>

          {effectiveReferenceMediaFileIds.length > 0 && (
            <div className="fb-bubble-reference-hint">
              Use REF 1, REF 2, ... in the prompt. {effectiveReferenceMediaFileIds.length}
              {typeof maxReferenceMedia === 'number' ? `/${maxReferenceMedia}` : ''} linked.
            </div>
          )}
        </div>
        )}
      </div>

      {!chatPanelOpen && !isAudioMode && renderMultiShotPanel && (
        <div className={`fb-multishot-panel ${isMultiShotPanelClosing ? 'is-closing' : 'is-opening'}`}>
          <div className="fb-multishot-header">
            <span>Shots</span>
            <span className={`fb-multishot-total ${multiShotValidationError ? 'error' : ''}`}>
              {multiShotDurationTotal}/{duration}s
            </span>
          </div>

          <div className="fb-multishot-list">
            {normalizedMultiPrompt.map((shot, index) => (
              <div key={`shot-${shot.index}`} className="fb-multishot-item">
                <div className="fb-multishot-item-header">
                  <span className="fb-multishot-item-title">Shot {shot.index}</span>
                  <div className="fb-multishot-item-actions">
                    <input
                      className="fb-multishot-duration"
                      type="number"
                      min={1}
                      max={duration}
                      value={shot.duration}
                      onChange={(e) => handleShotDurationChange(index, e.target.value)}
                    />
                    <span className="fb-multishot-duration-unit">s</span>
                    <button
                      className="fb-multishot-remove"
                      type="button"
                      onClick={() => handleRemoveShot(index)}
                      disabled={normalizedMultiPrompt.length <= 2}
                      title="Remove shot"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <textarea
                  className="fb-multishot-input"
                  value={shot.prompt}
                  onChange={(e) => handleShotPromptChange(index, e.target.value)}
                  placeholder={`Shot ${shot.index} prompt`}
                  rows={2}
                  maxLength={500}
                />
                <div className="fb-multishot-count">{shot.prompt.length}/500</div>
              </div>
            ))}
          </div>

          <div className="fb-multishot-footer">
            <button
              className="fb-multishot-add"
              type="button"
              onClick={handleAddShot}
              disabled={!canAddShot}
            >
              + Shot
            </button>
            <span className={`fb-multishot-hint ${multiShotValidationError ? 'error' : ''}`}>
              {multiShotValidationError ?? 'Multishot uses one start frame only and forces sound.'}
            </span>
          </div>
        </div>
      )}

      {!chatPanelOpen && isAudioMode && audioValidationError && (
        <div className="fb-audio-warning compact">{audioValidationError}</div>
      )}

      {!chatPanelOpen && seedanceReferenceValidationError && (
        <div className="fb-audio-warning compact">{seedanceReferenceValidationError}</div>
      )}

      {!chatPanelOpen && backendValidationError && (
        <div className={`fb-audio-warning compact ${showGenerationCloudActions ? 'has-cloud-actions' : ''}`}>
          <span>{backendValidationError}</span>
          {showGenerationCloudActions && (
            <div className="fb-cloud-warning-actions">
              <button type="button" onClick={openPricingDialog}>
                Prices
              </button>
              <button type="button" onClick={openAuthDialog}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}

      {!chatPanelOpen && promptRefineError && (
        <div className="fb-audio-warning compact">{promptRefineError}</div>
      )}

      <div className={`fb-bubble-bar ${inlineSubmenuStateClassName}`}>
        {!chatPanelOpen && (
        <div className="fb-control-stack">
          <div className={popoverHostClassName} ref={popoverRef}>
            <button className="fb-pill" onClick={() => togglePopover('model')} title={`Model: ${modelButtonLabel}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            </button>
            {isElevenLabsMode && (
              <>
                <button
                  className={`fb-pill ${popover === 'audioModel' ? 'active' : ''}`}
                  onClick={() => togglePopover('audioModel')}
                  title="ElevenLabs text-to-speech model"
                >
                  {audioModelButtonLabel}
                </button>
                <button
                  className={`fb-pill ${popover === 'voice' ? 'active' : ''}`}
                  onClick={() => togglePopover('voice')}
                  title="Voice"
                >
                  {audioVoiceButtonLabel}
                </button>
                <button
                  className={`fb-pill ${popover === 'audioOutput' ? 'active' : ''}`}
                  onClick={() => togglePopover('audioOutput')}
                  title="Output"
                >
                  {audioOutputButtonLabel}
                </button>
                <button
                  className={`fb-pill ${popover === 'voiceSettings' || voiceSettingsChanged ? 'active' : ''}`}
                  onClick={() => togglePopover('voiceSettings')}
                  title="Voice settings"
                >
                  Settings
                </button>
              </>
            )}
            {isSunoMode && (
              <>
                <button
                  className={`fb-pill ${popover === 'sunoModel' ? 'active' : ''}`}
                  onClick={() => togglePopover('sunoModel')}
                  title="Suno model"
                >
                  {sunoModelButtonLabel}
                </button>
                <button
                  className={`fb-pill ${popover === 'sunoMode' ? 'active' : ''}`}
                  onClick={() => togglePopover('sunoMode')}
                  title="Suno generation mode"
                >
                  {sunoModeButtonLabel}
                </button>
                <button
                  className={`fb-pill ${popover === 'sunoTuning' || sunoTuningChanged ? 'active' : ''}`}
                  onClick={() => togglePopover('sunoTuning')}
                  title="Suno tuning"
                >
                  Tuning
                </button>
              </>
            )}
            {!isAudioMode && selectedEntry && selectedEntry.aspectRatios.length > 0 && (
              <button className={`fb-pill ${popover === 'aspect' ? 'active' : ''}`} onClick={() => togglePopover('aspect')}>
                {aspectRatio}
              </button>
            )}
            {!isAudioMode && selectedEntry && selectedEntry.durations.length > 0 && (
              <button className={`fb-pill ${popover === 'duration' ? 'active' : ''}`} onClick={() => togglePopover('duration')}>
                {duration}s
              </button>
            )}
            {!isAudioMode && selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length ? (
              <button className={`fb-pill ${popover === 'imageSize' ? 'active' : ''}`} onClick={() => togglePopover('imageSize')}>
                {imageSize}
              </button>
            ) : null}
            {!isAudioMode && selectedEntry && selectedEntry.modes.length > 1 && (
              <button className={`fb-pill ${popover === 'mode' ? 'active' : ''}`} onClick={() => togglePopover('mode')}>
                {mode}
              </button>
            )}
            {supportsAudio && (
              <button className={`fb-pill ${effectiveGenerateAudio ? 'active' : ''}`} onClick={handleAudioToggle} title={multiShots ? 'Required for multishot' : 'Generate sound'}>
                {multiShots ? 'Sound req.' : 'Sound'}
              </button>
            )}
            {supportsMultiShot && (
              <button className={`fb-pill ${multiShots ? 'active' : ''}`} onClick={handleMultiShotToggle} title="Split the generation into multiple shots">
                Multi-shot
              </button>
            )}
            {(!isAudioMode || isSunoMode) && (
              <button
                className={`fb-pill fb-pill-icon fb-prompt-refine ${isRefiningPrompt ? 'active is-loading' : ''}`}
                type="button"
                onClick={handleRefinePrompt}
                disabled={isRefiningPrompt}
                title={isRefiningPrompt ? 'Refining prompt...' : promptRefineTitle}
                aria-label="Refine prompt"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
                  <path d="M5.5 12.5 13 5" />
                  <path d="m10.8 3.2 2 2" />
                  <path d="M2.8 1.6 3.3 3l1.5.5-1.5.5-.5 1.4L2.3 4 1 3.5 2.3 3l.5-1.4Z" />
                  <path d="m11.8 9.7.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" />
                </svg>
              </button>
            )}

          {renderedPopover === 'model' && (
            <div className="fb-popover fb-popover-model">
              <div className="fb-popover-title">Model</div>
              <div className="fb-model-category-tabs" role="tablist" aria-label="Model categories">
                {availableModelCategories.map((category) => (
                  <button
                    key={category.id}
                    className={`fb-model-category-tab category-${category.id} ${effectiveModelCategory === category.id ? 'active' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={effectiveModelCategory === category.id}
                    onClick={() => setActiveModelCategory(category.id)}
                  >
                    {renderModelCategoryIcon(category.id)}
                    <span className="fb-model-category-label">{category.label}</span>
                  </button>
                ))}
              </div>
              <div className="fb-model-list">
                <div className="fb-popover-pills">
                  {activeModelEntries.map((p) => {
                    const estimate = getCatalogEntryPriceEstimate(p, {
                      duration,
                      imageSize,
                      mode,
                      generateAudio: p.supportsGenerateAudio ? effectiveGenerateAudio : false,
                      multiShots: p.supportsMultiShot ? multiShots : false,
                      hasVideoInput: hasVideoReferenceInput,
                    });
                    const sourceLabel = getModelSourceLabel(p);
                    const metaLabel = [sourceLabel, estimate?.compactLabel].filter(Boolean).join(' - ');

                    return (
                      <button
                        key={`${p.service}-${p.providerId}`}
                        className={`fb-popover-pill ${service === p.service && providerId === p.providerId ? 'active' : ''}`}
                        type="button"
                        title={`${getProviderDisplayName(p)} via ${sourceLabel}`}
                        onClick={() => handleProviderChange(p.service, p.providerId)}
                      >
                        <span className="fb-popover-pill-label">{getProviderDisplayName(p)}</span>
                        {metaLabel && <span className="fb-popover-pill-meta">{metaLabel}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {renderedPopover === 'sunoModel' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Suno Model</div>
              <div className="fb-popover-pills">
                {SUNO_MODEL_IDS.map((model) => (
                  <button
                    key={model}
                    className={`fb-popover-pill ${normalizeSunoModel(version) === model ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      setVersion(model);
                      closePopover('sunoModel');
                    }}
                  >
                    <span className="fb-popover-pill-label">{SUNO_MODEL_LABELS[model] ?? model}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderedPopover === 'sunoMode' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Suno Mode</div>
              <div className="fb-popover-pills">
                {[
                  { label: 'Simple song', customMode: false, instrumental: false },
                  { label: 'Simple inst.', customMode: false, instrumental: true },
                  { label: 'Custom song', customMode: true, instrumental: false },
                  { label: 'Custom inst.', customMode: true, instrumental: true },
                ].map((option) => (
                  <button
                    key={`${option.customMode}-${option.instrumental}`}
                    className={`fb-popover-pill ${sunoCustomMode === option.customMode && sunoInstrumental === option.instrumental ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      setSunoCustomMode(option.customMode);
                      setSunoInstrumental(option.instrumental);
                      closePopover('sunoMode');
                    }}
                  >
                    <span className="fb-popover-pill-label">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderedPopover === 'sunoTuning' && isSunoMode && (
            <div className="fb-popover fb-popover-audio fb-popover-suno-tuning">
              <div className="fb-popover-title">Suno Tuning</div>
              <div className="fb-suno-tuning-panel">
                {[
                  { key: 'style', label: 'Style weight', value: sunoStyleWeight, onChange: setSunoStyleWeight },
                  { key: 'weirdness', label: 'Weirdness', value: sunoWeirdnessConstraint, onChange: setSunoWeirdnessConstraint },
                  { key: 'audio', label: 'Audio weight', value: sunoAudioWeight, onChange: setSunoAudioWeight },
                ].map((control) => (
                  <label className="fb-suno-tuning-row" key={control.key}>
                    <span>
                      <strong>{control.label}</strong>
                      <em>{control.value.toFixed(2)}</em>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={control.value}
                      onChange={(event) => control.onChange(Number(event.target.value))}
                    />
                  </label>
                ))}
                <div className="fb-suno-gender-row" aria-label="Singer gender">
                  <button
                    className={`fb-popover-pill ${sunoVocalGender === '' ? 'active' : ''}`}
                    type="button"
                    onClick={() => setSunoVocalGender('')}
                  >
                    <span className="fb-popover-pill-label">Auto vocal</span>
                  </button>
                  {Object.entries(SUNO_VOCAL_GENDER_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      className={`fb-popover-pill ${sunoVocalGender === value ? 'active' : ''}`}
                      type="button"
                      onClick={() => setSunoVocalGender(value as FlashBoardSunoVocalGender)}
                    >
                      <span className="fb-popover-pill-label">{label}</span>
                    </button>
                  ))}
                </div>
                <div className="fb-suno-tuning-actions">
                  <button className="fb-popover-pill" type="button" onClick={resetSunoTuning}>
                    <span className="fb-popover-pill-label">Reset</span>
                  </button>
                  <button className="fb-popover-pill active" type="button" onClick={() => closePopover('sunoTuning')}>
                    <span className="fb-popover-pill-label">Done</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {renderedPopover === 'audioModel' && isElevenLabsMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">ElevenLabs Model</div>
              <label className="fb-audio-popover-field">
                <span>Text-to-speech model</span>
                <select
                  className="fb-pill-select"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  {elevenLabsModelOptions.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fb-audio-model-meta">
                {isLoadingElevenLabsModels
                  ? 'Loading models...'
                  : elevenLabsModelsError
                    ? elevenLabsModelsError
                    : selectedElevenLabsModel?.description ?? selectedElevenLabsModel?.modelId}
              </div>
            </div>
          )}

          {renderedPopover === 'voice' && isElevenLabsMode && (
            <div className="fb-popover fb-popover-voice">
              <div className="fb-voice-picker">
                <div className="fb-voice-picker-header">
                  <span>Voice</span>
                  <button className="fb-pill" type="button" onClick={() => setVoiceRefreshNonce((current) => current + 1)}>
                    Refresh
                  </button>
                </div>
                <input
                  className="fb-pill-input fb-voice-search"
                  value={voiceSearch}
                  onChange={(e) => setVoiceSearch(e.target.value)}
                  placeholder="Search voices"
                />
                <div className="fb-voice-list">
                  {isLoadingElevenLabsVoices && (
                    <div className="fb-voice-empty">Loading voices...</div>
                  )}
                  {!isLoadingElevenLabsVoices && elevenLabsVoicesError && (
                    <div className="fb-voice-empty">{elevenLabsVoicesError}</div>
                  )}
                  {!isLoadingElevenLabsVoices && !elevenLabsVoicesError && elevenLabsVoices.length === 0 && (
                    <div className="fb-voice-empty">
                      {isHostedAudioMode
                        ? hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.'
                        : hasElevenLabsKey ? 'No voices found.' : 'Configure ElevenLabs key.'}
                    </div>
                  )}
                  {!isLoadingElevenLabsVoices && !elevenLabsVoicesError && elevenLabsVoices.map((voice) => (
                    <div
                      key={voice.voiceId}
                      className={`fb-voice-item ${voice.voiceId === voiceId ? 'active' : ''}`}
                    >
                      <button
                        className="fb-voice-main"
                        type="button"
                        onClick={() => handleSelectVoice(voice)}
                      >
                        <span className="fb-voice-name">{voice.name}</span>
                        <span className="fb-voice-meta">
                          {voice.category ?? voice.labels.gender ?? voice.labels.accent ?? voice.voiceId}
                        </span>
                      </button>
                      {voice.previewUrl && (
                        <button
                          className="fb-pill"
                          type="button"
                          onClick={() => handlePreviewVoice(voice.previewUrl)}
                        >
                          Preview
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="fb-audio-popover-grid">
                <label className="fb-audio-popover-field">
                  <span>Voice ID</span>
                  <input
                    className="fb-pill-input"
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value)}
                    placeholder="ElevenLabs voice_id"
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Voice name</span>
                  <input
                    className="fb-pill-input"
                    value={voiceName}
                    onChange={(e) => setVoiceName(e.target.value)}
                    placeholder="Optional label"
                  />
                </label>
              </div>
            </div>
          )}

          {renderedPopover === 'audioOutput' && isElevenLabsMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Output</div>
              <div className="fb-audio-popover-grid">
                <label className="fb-audio-popover-field">
                  <span>Format</span>
                  <select
                    className="fb-pill-select"
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(normalizeElevenLabsOutputFormat(e.target.value))}
                  >
                    {ELEVENLABS_MP3_OUTPUT_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {ELEVENLABS_OUTPUT_FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="fb-audio-popover-field fb-audio-language">
                  <input
                    type="checkbox"
                    checked={languageOverride}
                    onChange={(e) => setLanguageOverride(e.target.checked)}
                  />
                  <span>Language override</span>
                  <input
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    placeholder="en"
                    disabled={!languageOverride}
                  />
                </label>
              </div>
            </div>
          )}

          {renderedPopover === 'voiceSettings' && isElevenLabsMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Voice Settings</div>
              <div className="fb-audio-popover-grid">
                <label className="fb-audio-popover-field">
                  <span>Speed {voiceSettings.speed.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.7}
                    max={1.2}
                    step={0.01}
                    value={voiceSettings.speed}
                    onChange={(e) => handleVoiceSettingNumberChange('speed', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Stability {voiceSettings.stability.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={voiceSettings.stability}
                    onChange={(e) => handleVoiceSettingNumberChange('stability', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Similarity {voiceSettings.similarityBoost.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={voiceSettings.similarityBoost}
                    onChange={(e) => handleVoiceSettingNumberChange('similarityBoost', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Style {voiceSettings.style.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={voiceSettings.style}
                    onChange={(e) => handleVoiceSettingNumberChange('style', e.target.value)}
                  />
                </label>
              </div>
              <div className="fb-audio-actions">
                <label className="fb-pill-check">
                  <input
                    type="checkbox"
                    checked={voiceSettings.useSpeakerBoost}
                    onChange={(e) => setVoiceSettings((current) => ({
                      ...current,
                      useSpeakerBoost: e.target.checked,
                    }))}
                  />
                  <span>Speaker boost</span>
                </label>
                <button className="fb-pill" type="button" onClick={resetVoiceSettings}>
                  Reset voice
                </button>
              </div>
            </div>
          )}

          {renderedPopover === 'aspect' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Aspect Ratio</div>
              <div className="fb-popover-pills">
                {selectedEntry.aspectRatios.map((ar) => (
                  <button
                    key={ar}
                    className={`fb-popover-pill ${aspectRatio === ar ? 'active' : ''}`}
                    onClick={() => { setAspectRatio(ar); closePopover(); }}
                  >
                    <span className="fb-popover-pill-label">{ar}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderedPopover === 'duration' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Duration</div>
              <div className="fb-popover-pills">
                {selectedEntry.durations.map((d) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode,
                    duration: d,
                    imageSize,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                    hasVideoInput: hasVideoReferenceInput,
                  });

                  return (
                    <button
                      key={d}
                      className={`fb-popover-pill ${duration === d ? 'active' : ''}`}
                      onClick={() => { setDuration(d); closePopover(); }}
                    >
                      <span className="fb-popover-pill-label">{d}s</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {renderedPopover === 'imageSize' && selectedEntry?.imageSizes?.length ? (
            <div className="fb-popover">
              <div className="fb-popover-title">Image Size</div>
              <div className="fb-popover-pills">
                {selectedEntry.imageSizes.map((size) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode,
                    duration,
                    imageSize: size,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                    hasVideoInput: hasVideoReferenceInput,
                  });

                  return (
                    <button
                      key={size}
                      className={`fb-popover-pill ${imageSize === size ? 'active' : ''}`}
                      onClick={() => { setImageSize(size); closePopover(); }}
                    >
                      <span className="fb-popover-pill-label">{size}</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {renderedPopover === 'mode' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Mode</div>
              <div className="fb-popover-pills">
                {selectedEntry.modes.map((m) => {
                  const estimate = getFlashBoardPriceEstimate({
                    service,
                    providerId,
                    outputType: selectedEntry.outputType,
                    mode: m,
                    duration,
                    imageSize,
                    generateAudio: effectiveGenerateAudio,
                    multiShots,
                    hasVideoInput: hasVideoReferenceInput,
                  });

                  return (
                    <button
                      key={m}
                      className={`fb-popover-pill ${mode === m ? 'active' : ''}`}
                      onClick={() => { setMode(m); closePopover(); }}
                    >
                      <span className="fb-popover-pill-label">{m}</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </div>
          <div className="fb-selected-model-label" title={modelButtonLabel}>
            {modelButtonLabel}
          </div>
        </div>
        )}

        {chatPanelOpen && (
        <div className="fb-control-stack">
          <div className={popoverHostClassName} ref={popoverRef}>
            <button
              className={`fb-pill ${popover === 'chatProvider' ? 'active' : ''}`}
              onClick={() => togglePopover('chatProvider')}
              title={`Provider: ${chatProviderLabel}`}
            >
              {chatProviderLabel}
            </button>
            <button
              className={`fb-pill ${popover === 'chatModel' ? 'active' : ''}`}
              onClick={() => togglePopover('chatModel')}
              title={`Model: ${activeChatModel?.label ?? activeChatModelId}`}
            >
              {activeChatModel?.label ?? activeChatModelId}
            </button>
            {chatReasoningSupported && (
              <button
                className={`fb-pill ${popover === 'chatReasoning' ? 'active' : ''}`}
                onClick={() => togglePopover('chatReasoning')}
                title={`Reasoning effort: ${openAiReasoningEffort}`}
              >
                {openAiReasoningEffort}
              </button>
            )}
            <button
              className={`fb-pill ${popover === 'chatTemperature' ? 'active' : ''}`}
              onClick={() => togglePopover('chatTemperature')}
              title={chatTemperatureSupported ? `Temperature: ${chatTemperature.toFixed(1)}` : 'Temperature fixed for this model'}
            >
              {chatTemperatureSupported ? `Temp ${chatTemperature.toFixed(1)}` : 'Fixed temp'}
            </button>
            {chatCreditLabel && (
              <span className="fb-pill fb-chat-cost-pill" title={chatChargeTitle}>
                {chatCreditLabel}/round
              </span>
            )}
            <button
              className="fb-pill fb-chat-clear-pill"
              type="button"
              onClick={handleClearChatHistory}
              disabled={chatMessages.length === 0 && !chatPrompt && !chatError}
              title="Clear chat history and start a new chat"
            >
              New
            </button>

            {renderedPopover === 'chatProvider' && (
              <div className="fb-popover">
                <div className="fb-popover-title">Provider</div>
                <div className="fb-popover-pills">
                  {chatProviderOptions.map((provider) => (
                    <button
                      key={provider.id}
                      className={`fb-popover-pill ${chatProvider === provider.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        handleChatProviderSelect(provider.id);
                        closePopover('chatProvider');
                      }}
                      disabled={isChatting}
                    >
                      <span className="fb-popover-pill-label">{provider.label}</span>
                    </button>
                  ))}
                </div>
                {chatProvider === 'lemonade' && (
                  <div className={`fb-chat-status ${lemonadeStatus}`}>
                    {lemonadeStatus === 'idle' ? 'Local' : lemonadeStatus}
                  </div>
                )}
              </div>
            )}

            {renderedPopover === 'chatModel' && (
              <div className="fb-popover">
                <div className="fb-popover-title">Model</div>
                <div className="fb-popover-pills">
                  {chatModelOptions.map((model) => (
                    <button
                      key={model.id}
                      className={`fb-popover-pill ${activeChatModelId === model.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        setChatModel(model.id);
                        setChatError(null);
                        closePopover('chatModel');
                      }}
                      disabled={isChatting}
                      title={model.id}
                    >
                      <span className="fb-popover-pill-label">{model.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {renderedPopover === 'chatReasoning' && (
              <div className="fb-popover">
                <div className="fb-popover-title">Reasoning</div>
                <div className="fb-popover-pills">
                  {chatReasoningEffortOptions.map((option) => (
                    <button
                      key={option.id}
                      className={`fb-popover-pill ${openAiReasoningEffort === option.id ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        setOpenAiReasoningEffort(option.id);
                        setChatError(null);
                        closePopover('chatReasoning');
                      }}
                      disabled={isChatting}
                    >
                      <span className="fb-popover-pill-label">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {renderedPopover === 'chatTemperature' && (
              <div className="fb-popover fb-chat-temperature-popover">
                <div className="fb-popover-title">Temperature</div>
                <label className={`fb-chat-temperature ${chatTemperatureSupported ? '' : 'disabled'}`}>
                  <span>Temp</span>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={chatTemperature}
                    onChange={(event) => setChatTemperature(Number(event.target.value))}
                    disabled={isChatting || !chatTemperatureSupported}
                  />
                  <strong>{chatTemperatureSupported ? chatTemperature.toFixed(1) : 'fixed'}</strong>
                </label>
              </div>
            )}
          </div>
          <div
            className="fb-selected-model-label fb-chat-selected-model-label"
            title={`${chatProviderLabel} / ${activeChatModel?.label ?? activeChatModelId}`}
          >
            Chat
          </div>
        </div>
        )}

        <div className="fb-action-stack">
          {chatPanelOpen ? (
            <button
              className="fb-generate fb-chat-button active"
              onClick={handleChatButtonClick}
              title={chatChargeTitle ?? 'Send chat prompt'}
            >
              <svg
                className="fb-generate-icon"
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M3.4 3.5h9.2a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H7.2L3.6 14v-2.5h-.2a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8Z" />
                <path d="M5 6.5h6M5 8.9h4" />
              </svg>
              <span>{chatButtonLabel}</span>
            </button>
          ) : (
          <button
            className="fb-generate"
            disabled={!canGenerate}
            onClick={handleGenerate}
            title={currentPrice ? `${currentPrice.fullLabel} (Ctrl+Enter)` : `${generateActionLabel} (Ctrl+Enter)`}
          >
            <svg
              className="fb-generate-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
              <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
            </svg>
            <span>{generateButtonLabel}</span>
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
