import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
} from '../../../stores/flashboardStore/defaults';
import { selectActiveBoard } from '../../../stores/flashboardStore/selectors';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';
import {
  ELEVENLABS_MP3_OUTPUT_FORMATS,
  elevenLabsService,
  isElevenLabsMp3OutputFormat,
  type ElevenLabsModel,
  type ElevenLabsModelRates,
  type ElevenLabsMp3OutputFormat,
  type ElevenLabsVoice,
} from '../../../services/elevenLabsService';
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
import type { CatalogEntry } from '../../../services/flashboard/types';

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
  | 'sunoDetails'
  | 'sunoTuning'
  | null;
type NumberVoiceSettingKey = 'speed' | 'stability' | 'similarityBoost' | 'style';
type NumberSunoSettingKey = 'styleWeight' | 'weirdnessConstraint' | 'audioWeight';

interface ComposerReferenceBadge {
  key: string;
  role: FlashBoardComposerReferenceRole;
  mediaFileId: string;
  roleLabel: string;
  displayName: string;
}

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

const MAX_MULTI_SHOTS = 5;

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

function getServiceLabel(service: CatalogEntry['service']): string {
  switch (service) {
    case 'kieai':
      return 'Kie.ai';
    case 'piapi':
      return 'PiAPI';
    case 'cloud':
      return 'Cloud';
    case 'elevenlabs':
      return 'Audio';
    case 'suno':
      return 'Suno';
    default:
      return service;
  }
}

function getProviderDisplayName(entry: CatalogEntry): string {
  if (entry.service === 'elevenlabs') {
    return 'ElevenLabs Speech';
  }

  if (entry.service === 'suno') {
    return 'Suno Music';
  }

  return entry.name.replace(' (Kie.ai)', '');
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

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
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
  const kieAiApiKey = useSettingsStore((s) => s.apiKeys.kieai);
  const elevenLabsApiKey = useSettingsStore((s) => s.apiKeys.elevenlabs);
  const hasKieAiKey = kieAiApiKey.trim().length > 0;
  const hasElevenLabsKey = elevenLabsApiKey.trim().length > 0;
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);

  const catalog = useMemo(() => getCatalogEntries(), []);
  const visibleCatalog = useMemo(
    () => catalog.filter((entry) => {
      if (serviceScope && entry.service !== serviceScope) {
        return false;
      }
      if (allowedServices?.length && !allowedServices.includes(entry.service)) {
        return false;
      }
      return true;
    }),
    [allowedServices, catalog, serviceScope],
  );
  const serviceOptions = useMemo(
    () => Array.from(new Set(visibleCatalog.map((entry) => entry.service))),
    [visibleCatalog],
  );
  const initialEntry = useMemo(
    () => (
      visibleCatalog.find((entry) => {
        const serviceMatches = (serviceScope ?? initialService ?? entry.service) === entry.service;
        const providerMatches = !initialProviderId || entry.providerId === initialProviderId;
        return serviceMatches && providerMatches;
      }) ?? visibleCatalog[0]
    ),
    [initialProviderId, initialService, serviceScope, visibleCatalog],
  );

  const [popover, setPopover] = useState<PopoverType>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const [service, setService] = useState<CatalogEntry['service']>(
    initialEntry?.service ?? serviceScope ?? initialService ?? 'kieai',
  );
  const [providerId, setProviderId] = useState(initialProviderId ?? initialEntry?.providerId ?? '');
  const [version, setVersion] = useState(initialVersion ?? initialEntry?.versions[0] ?? DEFAULT_ELEVENLABS_MODEL_ID);
  const [mode, setMode] = useState('std');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [generateAudio, setGenerateAudio] = useState(false);
  const [multiShots, setMultiShots] = useState(false);
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
  const [sunoTitle, setSunoTitle] = useState(composer.sunoTitle ?? '');
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

  const selectedEntry = useMemo(
    () => visibleCatalog.find((e) => e.service === service && e.providerId === providerId),
    [providerId, service, visibleCatalog],
  );
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
  const sunoDetailsButtonLabel = sunoTitle.trim() || sunoStyle.trim() || 'Song details';
  const sunoTuningChanged = sunoStyleWeight !== DEFAULT_SUNO_STYLE_WEIGHT
    || sunoWeirdnessConstraint !== DEFAULT_SUNO_WEIRDNESS_CONSTRAINT
    || sunoAudioWeight !== DEFAULT_SUNO_AUDIO_WEIGHT
    || sunoVocalGender !== '';
  const supportsAudio = !isAudioMode && selectedEntry?.supportsGenerateAudio === true;
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const normalizedMultiPrompt = useMemo(
    () => multiShots ? rebalanceMultiPrompts(multiPrompt, duration) : [],
    [duration, multiPrompt, multiShots],
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
      if (!hasKieAiKey) {
        return 'Add a Kie.ai API key in Settings to generate Suno music.';
      }

      const model = normalizeSunoModel(version);
      const promptLimit = getSunoPromptLimit(model, sunoCustomMode);
      const styleLimit = getSunoStyleLimit(model);

      if (effectivePrompt.length > promptLimit) {
        return `Prompt exceeds the selected Suno limit of ${promptLimit.toLocaleString()} characters.`;
      }

      if (sunoCustomMode) {
        if (!sunoTitle.trim()) {
          return 'Add a Suno song title.';
        }

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
    sunoCustomMode,
    sunoStyle,
    sunoTitle,
    version,
    voiceId,
  ]);
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
      })
      : null
  ), [
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    imageSize,
    mode,
    multiShots,
    providerId,
    selectedElevenLabsModel?.modelRates,
    selectedEntry,
    service,
    version,
  ]);
  const maxReferenceImages = !isAudioMode && selectedEntry?.supportsTextToImage
    ? selectedEntry.maxReferenceImages
    : undefined;
  const effectiveReferenceMediaFileIds = useMemo(
    () => clampReferenceMediaFileIds(composer.referenceMediaFileIds ?? [], maxReferenceImages),
    [composer.referenceMediaFileIds, maxReferenceImages],
  );
  const canGenerate = Boolean(board && selectedEntry && effectivePrompt)
    && !multiShotValidationError
    && !audioValidationError;
  const canAddShot = multiShots && normalizedMultiPrompt.length < Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));
  const mediaFileNamesById = useMemo(
    () => new Map(mediaFiles.map((file) => [file.id, file.name])),
    [mediaFiles],
  );
  const composerReferenceBadges = useMemo<ComposerReferenceBadge[]>(() => {
    const badges: ComposerReferenceBadge[] = [];

    if (composer.startMediaFileId) {
      badges.push({
        key: `start-${composer.startMediaFileId}`,
        role: 'start',
        mediaFileId: composer.startMediaFileId,
        roleLabel: 'IN',
        displayName: mediaFileNamesById.get(composer.startMediaFileId) ?? 'Start frame',
      });
    }

    if (composer.endMediaFileId) {
      badges.push({
        key: `end-${composer.endMediaFileId}`,
        role: 'end',
        mediaFileId: composer.endMediaFileId,
        roleLabel: 'OUT',
        displayName: mediaFileNamesById.get(composer.endMediaFileId) ?? 'End frame',
      });
    }

    effectiveReferenceMediaFileIds.forEach((mediaFileId, index) => {
      badges.push({
        key: `reference-${mediaFileId}`,
        role: 'reference',
        mediaFileId,
        roleLabel: `REF ${index + 1}`,
        displayName: mediaFileNamesById.get(mediaFileId) ?? 'Reference frame',
      });
    });

    return badges;
  }, [composer.endMediaFileId, composer.startMediaFileId, effectiveReferenceMediaFileIds, mediaFileNamesById]);

  useEffect(() => {
    if (!initialEntry) {
      return;
    }

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

      if (!initialEntry.modes.includes(mode)) {
        setMode(initialEntry.modes[0] ?? 'std');
      }
      if (!initialEntry.durations.includes(duration) && initialEntry.durations.length > 0) {
        setDuration(initialEntry.durations[0] ?? 5);
      }
      if (!initialEntry.aspectRatios.includes(aspectRatio) && initialEntry.aspectRatios.length > 0) {
        setAspectRatio(initialEntry.aspectRatios[0] ?? '16:9');
      }
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
  }, [aspectRatio, duration, initialEntry, initialVersion, mode]);

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
        setMultiPrompt([]);
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
      if (composer.referenceMediaFileIds.length > 0) nextPatch.referenceMediaFileIds = [];
    }

    if (!isAudioMode && !selectedEntry.supportsImageToVideo) {
      if (composer.startMediaFileId !== undefined) nextPatch.startMediaFileId = undefined;
      if (composer.endMediaFileId !== undefined) nextPatch.endMediaFileId = undefined;
    }

    if (!isAudioMode && multiShots && composer.endMediaFileId !== undefined) {
      nextPatch.endMediaFileId = undefined;
    }

    if (!isAudioMode && !selectedEntry.supportsTextToImage && composer.referenceMediaFileIds.length > 0) {
      nextPatch.referenceMediaFileIds = [];
    }

    if (
      !isAudioMode
      && selectedEntry.supportsTextToImage
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
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

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
        referenceMediaFileIds: !nextIsAudio && entry.supportsTextToImage
          ? clampReferenceMediaFileIds(composer.referenceMediaFileIds, entry.maxReferenceImages)
          : [],
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
    setPopover(null);
  }, [
    aspectRatio,
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
      sunoTitle: requestIsSuno ? sunoTitle.trim() : undefined,
      sunoNegativeTags: requestIsSuno ? sunoNegativeTags.trim() || undefined : undefined,
      sunoVocalGender: requestIsSuno ? sunoVocalGender || undefined : undefined,
      sunoStyleWeight: requestIsSuno ? sunoStyleWeight : undefined,
      sunoWeirdnessConstraint: requestIsSuno ? sunoWeirdnessConstraint : undefined,
      sunoAudioWeight: requestIsSuno ? sunoAudioWeight : undefined,
      startMediaFileId: !requestIsAudio && selectedEntry.supportsImageToVideo ? composer.startMediaFileId : undefined,
      endMediaFileId: !requestIsAudio && selectedEntry.supportsImageToVideo && !multiShots ? composer.endMediaFileId : undefined,
      referenceMediaFileIds: !requestIsAudio && selectedEntry.supportsTextToImage ? effectiveReferenceMediaFileIds : [],
    });
    queueNode(node.id);
    setPrompt('');
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleGenerate();
    }
  }, [handleGenerate]);

  const togglePopover = useCallback((type: PopoverType) => {
    setPopover((prev) => prev === type ? null : type);
  }, []);

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
      } else {
        setMultiPrompt([]);
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

  const handleSunoSettingNumberChange = useCallback((key: NumberSunoSettingKey, value: string) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    const clamped = clampSunoWeight(nextValue, 0);
    if (key === 'styleWeight') {
      setSunoStyleWeight(clamped);
    } else if (key === 'weirdnessConstraint') {
      setSunoWeirdnessConstraint(clamped);
    } else {
      setSunoAudioWeight(clamped);
    }
  }, []);

  const resetSunoTuning = useCallback(() => {
    setSunoVocalGender('');
    setSunoStyleWeight(DEFAULT_SUNO_STYLE_WEIGHT);
    setSunoWeirdnessConstraint(DEFAULT_SUNO_WEIRDNESS_CONSTRAINT);
    setSunoAudioWeight(DEFAULT_SUNO_AUDIO_WEIGHT);
  }, []);

  if (!board) return null;

  return (
    <div className="fb-bubble" onKeyDown={handleKeyDown} onMouseDown={(e) => e.stopPropagation()}>
      <div className="fb-bubble-row">
        <textarea
          className="fb-bubble-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isSunoMode
              ? 'Describe the song, mood, lyrics, or background music...'
              : isAudioMode
              ? 'Text to speak...'
              : multiShots
                ? 'Overall scene or style (optional when using multishot)...'
                : 'Describe what to generate...'
          }
          rows={isAudioMode ? 2 : multiShots ? 3 : 2}
        />
        <button className="fb-bubble-close" onClick={() => setPrompt('')} title="Clear">&times;</button>
      </div>

      {!isAudioMode && composerReferenceBadges.length > 0 && (
        <>
          <div className="fb-bubble-reference-badges">
            {composerReferenceBadges.map((badge) => (
              <div
                key={badge.key}
                className={`fb-bubble-reference-badge ${badge.role}`}
                title={badge.displayName}
                onMouseEnter={() => setHoveredComposerReference({ mediaFileId: badge.mediaFileId, role: badge.role })}
                onMouseLeave={() => setHoveredComposerReference(null)}
              >
                <span className="fb-bubble-reference-role">{badge.roleLabel}</span>
                <span className="fb-bubble-reference-name">{badge.displayName}</span>
                <button
                  className="fb-bubble-reference-close"
                  type="button"
                  onClick={() => handleRemoveComposerReference(badge)}
                  title={`Remove ${badge.roleLabel}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
          {selectedEntry?.supportsTextToImage && effectiveReferenceMediaFileIds.length > 0 && (
            <div className="fb-bubble-reference-hint">
              Use REF 1, REF 2, ... in the prompt. {effectiveReferenceMediaFileIds.length}
              {typeof maxReferenceImages === 'number' ? `/${maxReferenceImages}` : ''} linked.
            </div>
          )}
        </>
      )}

      {!isAudioMode && multiShots && (
        <div className="fb-multishot-panel">
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

      {isAudioMode && audioValidationError && (
        <div className="fb-audio-warning compact">{audioValidationError}</div>
      )}

      <div className="fb-bubble-bar">
        <div className="fb-pill-group" ref={popoverRef}>
          <button className="fb-pill" onClick={() => togglePopover('model')} title="Model">
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
                className={`fb-pill ${popover === 'sunoDetails' ? 'active' : ''}`}
                onClick={() => togglePopover('sunoDetails')}
                title="Suno song details"
              >
                {sunoDetailsButtonLabel}
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

          {popover === 'model' && (
            <div className="fb-popover fb-popover-model">
              <div className="fb-popover-title">Model</div>
              {serviceOptions.map((svc) => {
                const providers = visibleCatalog.filter((e) => e.service === svc);
                if (providers.length === 0) return null;
                return (
                  <div key={svc} className="fb-popover-group">
                    {(serviceOptions.length > 1 || providers.length > 1) && (
                      <div className="fb-popover-label">{getServiceLabel(svc)}</div>
                    )}
                    <div className="fb-popover-pills">
                      {providers.map((p) => {
                        const estimate = getCatalogEntryPriceEstimate(p, {
                          duration,
                          imageSize,
                          mode,
                          generateAudio: p.supportsGenerateAudio ? effectiveGenerateAudio : false,
                          multiShots: p.supportsMultiShot ? multiShots : false,
                        });

                        return (
                          <button
                            key={`${p.service}-${p.providerId}`}
                            className={`fb-popover-pill ${service === svc && providerId === p.providerId ? 'active' : ''}`}
                            onClick={() => handleProviderChange(svc, p.providerId)}
                          >
                            <span className="fb-popover-pill-label">{getProviderDisplayName(p)}</span>
                            {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {popover === 'sunoModel' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Suno Model</div>
              <label className="fb-audio-popover-field">
                <span>Music model</span>
                <select
                  className="fb-pill-select"
                  value={normalizeSunoModel(version)}
                  onChange={(e) => setVersion(normalizeSunoModel(e.target.value))}
                >
                  {SUNO_MODEL_IDS.map((model) => (
                    <option key={model} value={model}>
                      {SUNO_MODEL_LABELS[model] ?? model}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fb-audio-model-meta">
                {sunoCustomMode
                  ? `${getSunoPromptLimit(version, true).toLocaleString()} prompt chars, ${getSunoStyleLimit(version).toLocaleString()} style chars`
                  : 'Simple prompt mode supports up to 500 characters.'}
              </div>
            </div>
          )}

          {popover === 'sunoMode' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Suno Mode</div>
              <div className="fb-audio-actions">
                <label className="fb-pill-check">
                  <input
                    type="checkbox"
                    checked={sunoCustomMode}
                    onChange={(e) => setSunoCustomMode(e.target.checked)}
                  />
                  <span>Custom mode</span>
                </label>
                <label className="fb-pill-check">
                  <input
                    type="checkbox"
                    checked={sunoInstrumental}
                    onChange={(e) => setSunoInstrumental(e.target.checked)}
                  />
                  <span>Instrumental</span>
                </label>
              </div>
              <div className="fb-audio-model-meta">
                {sunoCustomMode
                  ? 'Custom mode uses the main prompt plus explicit title and style fields.'
                  : 'Simple mode lets Suno infer lyrics, style, and structure from the prompt.'}
              </div>
            </div>
          )}

          {popover === 'sunoDetails' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Song Details</div>
              <div className="fb-audio-popover-grid">
                <label className="fb-audio-popover-field">
                  <span>Title</span>
                  <input
                    className="fb-pill-input"
                    value={sunoTitle}
                    onChange={(e) => setSunoTitle(e.target.value)}
                    placeholder="Optional in simple mode"
                    maxLength={80}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Style</span>
                  <input
                    className="fb-pill-input"
                    value={sunoStyle}
                    onChange={(e) => setSunoStyle(e.target.value)}
                    placeholder="cinematic synthwave, ambient piano..."
                    maxLength={getSunoStyleLimit(version)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Negative tags</span>
                  <input
                    className="fb-pill-input"
                    value={sunoNegativeTags}
                    onChange={(e) => setSunoNegativeTags(e.target.value)}
                    placeholder="distorted vocals, harsh noise..."
                    maxLength={500}
                  />
                </label>
              </div>
            </div>
          )}

          {popover === 'sunoTuning' && isSunoMode && (
            <div className="fb-popover fb-popover-audio">
              <div className="fb-popover-title">Suno Tuning</div>
              <div className="fb-audio-popover-grid">
                <label className="fb-audio-popover-field">
                  <span>Style weight {sunoStyleWeight.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sunoStyleWeight}
                    onChange={(e) => handleSunoSettingNumberChange('styleWeight', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Weirdness {sunoWeirdnessConstraint.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sunoWeirdnessConstraint}
                    onChange={(e) => handleSunoSettingNumberChange('weirdnessConstraint', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Audio weight {sunoAudioWeight.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sunoAudioWeight}
                    onChange={(e) => handleSunoSettingNumberChange('audioWeight', e.target.value)}
                  />
                </label>
                <label className="fb-audio-popover-field">
                  <span>Vocal gender</span>
                  <select
                    className="fb-pill-select"
                    value={sunoVocalGender}
                    onChange={(e) => setSunoVocalGender(e.target.value as FlashBoardSunoVocalGender | '')}
                  >
                    <option value="">Auto</option>
                    {Object.entries(SUNO_VOCAL_GENDER_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fb-audio-actions">
                <button className="fb-pill" type="button" onClick={resetSunoTuning}>
                  Reset tuning
                </button>
              </div>
            </div>
          )}

          {popover === 'audioModel' && isElevenLabsMode && (
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

          {popover === 'voice' && isElevenLabsMode && (
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

          {popover === 'audioOutput' && isElevenLabsMode && (
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

          {popover === 'voiceSettings' && isElevenLabsMode && (
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

          {popover === 'aspect' && selectedEntry && (
            <div className="fb-popover">
              <div className="fb-popover-title">Aspect Ratio</div>
              <div className="fb-popover-pills">
                {selectedEntry.aspectRatios.map((ar) => (
                  <button
                    key={ar}
                    className={`fb-popover-pill ${aspectRatio === ar ? 'active' : ''}`}
                    onClick={() => { setAspectRatio(ar); setPopover(null); }}
                  >
                    <span className="fb-popover-pill-label">{ar}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {popover === 'duration' && selectedEntry && (
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
                  });

                  return (
                    <button
                      key={d}
                      className={`fb-popover-pill ${duration === d ? 'active' : ''}`}
                      onClick={() => { setDuration(d); setPopover(null); }}
                    >
                      <span className="fb-popover-pill-label">{d}s</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {popover === 'imageSize' && selectedEntry?.imageSizes?.length ? (
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
                  });

                  return (
                    <button
                      key={size}
                      className={`fb-popover-pill ${imageSize === size ? 'active' : ''}`}
                      onClick={() => { setImageSize(size); setPopover(null); }}
                    >
                      <span className="fb-popover-pill-label">{size}</span>
                      {estimate && <span className="fb-popover-pill-meta">{estimate.compactLabel}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {popover === 'mode' && selectedEntry && (
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
                  });

                  return (
                    <button
                      key={m}
                      className={`fb-popover-pill ${mode === m ? 'active' : ''}`}
                      onClick={() => { setMode(m); setPopover(null); }}
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

        <button
          className="fb-generate"
          disabled={!canGenerate}
          onClick={handleGenerate}
          title={currentPrice ? `${currentPrice.fullLabel} (Ctrl+Enter)` : 'Generate (Ctrl+Enter)'}
        >
          {currentPrice
            ? `\u25B6 Generate \u00B7 ${currentPrice.compactLabel}`
            : isSunoMode ? '\u25B6 Compose' : isAudioMode ? '\u25B6 Speak' : '\u25B6 Generate'}
        </button>
      </div>
    </div>
  );
}
