import {
  DEFAULT_FLASHBOARD_PROVIDER_ID,
  DEFAULT_FLASHBOARD_SERVICE,
} from '../../../stores/flashboardStore/defaults';
import { SUNO_PROVIDER_ID, SUNO_SOUNDS_PROVIDER_ID } from '../../../services/sunoService';
import { getCatalogEntries } from '../../../services/flashboard/FlashBoardModelCatalog';
import { getCatalogEntryPriceEstimate } from '../../../services/flashboard/FlashBoardPricing';
import type { CatalogEntry } from '../../../services/flashboard/types';

export type FlashBoardModelCategoryId = 'image' | 'video' | 'voice' | 'music';

export interface FlashBoardModelCategoryOption {
  id: FlashBoardModelCategoryId;
  label: string;
}

export interface FlashBoardModelEntryOption {
  id: string;
  active: boolean;
  label: string;
  meta?: string;
  providerId: string;
  service: CatalogEntry['service'];
  title: string;
}

interface BuildFlashBoardModelCatalogStateInput {
  allowedServices?: CatalogEntry['service'][];
  hasHostedSession: boolean;
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  serviceScope?: CatalogEntry['service'];
  useElevenLabsKeyByDefault: boolean;
  useEvolinkKeyByDefault: boolean;
  useHostedProductionProviders: boolean;
  useKieAiKeyByDefault: boolean;
  usePiApiKeyByDefault: boolean;
}

interface BuildFlashBoardModelOptionsStateInput {
  activeModelCategory: FlashBoardModelCategoryId;
  providerId: string;
  service: CatalogEntry['service'];
  visibleCatalog: CatalogEntry[];
}

interface BuildFlashBoardModelEntryOptionsInput {
  activeModelEntries: CatalogEntry[];
  duration: number;
  effectiveGenerateAudio: boolean;
  hasVideoReferenceInput: boolean;
  imageSize: string;
  mode: string;
  multiShots: boolean;
  providerId: string;
  service: CatalogEntry['service'];
}

export interface FlashBoardModelCatalogState {
  emptyCatalogFallbackService: CatalogEntry['service'];
  initialEntry: CatalogEntry | undefined;
  visibleCatalog: CatalogEntry[];
}

export interface FlashBoardModelOptionsState {
  activeModelEntries: CatalogEntry[];
  availableModelCategories: FlashBoardModelCategoryOption[];
  effectiveModelCategory: FlashBoardModelCategoryId;
  modelButtonLabel: string;
  selectedEntry: CatalogEntry | undefined;
  selectedModelCategory: FlashBoardModelCategoryId;
}

const MODEL_CATEGORIES: FlashBoardModelCategoryOption[] = [
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'voice', label: 'Voice' },
  { id: 'music', label: 'Music' },
];

function createModelEntriesByCategory(): Record<FlashBoardModelCategoryId, CatalogEntry[]> {
  return {
    image: [],
    video: [],
    voice: [],
    music: [],
  };
}

export function getFlashBoardModelCategory(entry: CatalogEntry | undefined): FlashBoardModelCategoryId {
  if (!entry) {
    return 'video';
  }

  if (
    entry.service === 'suno'
    || entry.providerId === SUNO_PROVIDER_ID
    || entry.providerId === SUNO_SOUNDS_PROVIDER_ID
  ) {
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

function getModelDisplayName(entry: CatalogEntry): string {
  if (entry.service === 'elevenlabs') {
    return 'ElevenLabs Speech';
  }

  if (entry.providerId === SUNO_PROVIDER_ID) {
    return 'Suno Music';
  }

  return entry.name.replace(' (Kie.ai)', '').replace(' (EvoLink)', '');
}

function isCatalogEntryVisible({
  allowedServices,
  entry,
  hasHostedSession,
  serviceScope,
  useElevenLabsKeyByDefault,
  useEvolinkKeyByDefault,
  useHostedProductionProviders,
  useKieAiKeyByDefault,
  usePiApiKeyByDefault,
}: BuildFlashBoardModelCatalogStateInput & { entry: CatalogEntry }): boolean {
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
}

function findInitialEntry({
  initialProviderId,
  initialService,
  serviceScope,
  visibleCatalog,
}: Pick<
  BuildFlashBoardModelCatalogStateInput,
  'initialProviderId' | 'initialService' | 'serviceScope'
> & {
  visibleCatalog: CatalogEntry[];
}): CatalogEntry | undefined {
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
}

export function buildFlashBoardModelCatalogState(
  input: BuildFlashBoardModelCatalogStateInput,
): FlashBoardModelCatalogState {
  const cloudFallbackAllowed = !input.serviceScope && (!input.allowedServices?.length || input.allowedServices.includes('cloud'));
  const emptyCatalogFallbackService: CatalogEntry['service'] = cloudFallbackAllowed
    ? 'cloud'
    : input.serviceScope ?? input.initialService ?? DEFAULT_FLASHBOARD_SERVICE;
  const visibleCatalog = getCatalogEntries().filter((entry) => isCatalogEntryVisible({ ...input, entry }));
  const initialEntry = findInitialEntry({
    initialProviderId: input.initialProviderId,
    initialService: input.initialService,
    serviceScope: input.serviceScope,
    visibleCatalog,
  });

  return {
    emptyCatalogFallbackService,
    initialEntry,
    visibleCatalog,
  };
}

export function buildFlashBoardModelOptionsState({
  activeModelCategory,
  providerId,
  service,
  visibleCatalog,
}: BuildFlashBoardModelOptionsStateInput): FlashBoardModelOptionsState {
  const modelEntriesByCategory = visibleCatalog.reduce<Record<FlashBoardModelCategoryId, CatalogEntry[]>>((groups, entry) => {
    groups[getFlashBoardModelCategory(entry)].push(entry);
    return groups;
  }, createModelEntriesByCategory());
  const availableModelCategories = MODEL_CATEGORIES.filter((category) => modelEntriesByCategory[category.id].length > 0);
  const selectedEntry = visibleCatalog.find((entry) => entry.service === service && entry.providerId === providerId);
  const selectedModelCategory = getFlashBoardModelCategory(selectedEntry);
  const effectiveModelCategory = modelEntriesByCategory[activeModelCategory].length > 0
    ? activeModelCategory
    : availableModelCategories[0]?.id ?? selectedModelCategory;
  const activeModelEntries = modelEntriesByCategory[effectiveModelCategory] ?? [];

  return {
    activeModelEntries,
    availableModelCategories,
    effectiveModelCategory,
    modelButtonLabel: selectedEntry ? getModelDisplayName(selectedEntry) : 'Model',
    selectedEntry,
    selectedModelCategory,
  };
}

export function buildFlashBoardModelEntryOptions({
  activeModelEntries,
  duration,
  effectiveGenerateAudio,
  hasVideoReferenceInput,
  imageSize,
  mode,
  multiShots,
  providerId,
  service,
}: BuildFlashBoardModelEntryOptionsInput): FlashBoardModelEntryOption[] {
  return activeModelEntries.map((entry) => {
    const estimate = getCatalogEntryPriceEstimate(entry, {
      duration,
      imageSize,
      mode,
      generateAudio: entry.supportsGenerateAudio ? effectiveGenerateAudio : false,
      multiShots: entry.supportsMultiShot ? multiShots : false,
      hasVideoInput: hasVideoReferenceInput,
    });
    const sourceLabel = getModelSourceLabel(entry);
    const label = getModelDisplayName(entry);
    const meta = [sourceLabel, estimate?.compactLabel].filter(Boolean).join(' - ');

    return {
      id: `${entry.service}:${entry.providerId}`,
      active: service === entry.service && providerId === entry.providerId,
      label,
      meta,
      providerId: entry.providerId,
      service: entry.service,
      title: `${label} via ${sourceLabel}`,
    };
  });
}
