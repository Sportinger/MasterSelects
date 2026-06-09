import type {
  FlashBoardPromptRefinerReference,
  ParsedSunoPromptRefinement,
  RefineFlashBoardPromptInput,
} from '../../../services/flashboard/FlashBoardPromptRefiner';
import type { CatalogEntry } from '../../../services/flashboard/types';

interface FlashBoardPromptRefineReferenceBadge {
  displayName: string;
  mediaFileId: string;
  mediaType: FlashBoardPromptRefinerReference['mediaType'];
  previewUrl?: string;
  role: FlashBoardPromptRefinerReference['role'];
  roleLabel: string;
  thumbnailUrl?: string;
}

interface FlashBoardPromptRefineMediaFile {
  file?: File;
  type: FlashBoardPromptRefinerReference['mediaType'];
  url?: string;
}

interface HasFlashBoardPromptRefineInputInput {
  isSunoMode: boolean;
  prompt: string;
  referenceCount: number;
  sunoNegativeTags: string;
  sunoStyle: string;
}

export interface SunoPromptSnapshot {
  prompt: string;
  style: string;
  negativeTags: string;
}

export interface FlashBoardPromptRefineFieldUpdate {
  prompt?: string;
  sunoCustomMode?: boolean;
  sunoNegativeTags?: string;
  sunoStyle?: string;
}

export interface FlashBoardPromptRefineDeltaUpdate {
  fields: FlashBoardPromptRefineFieldUpdate;
  hasSunoFields: boolean;
}

interface BuildFlashBoardPromptRefineInputInput {
  apiKey: string;
  aspectRatio: string;
  duration: number;
  entry: CatalogEntry;
  generateAudio: boolean;
  getMediaFile: (mediaFileId: string) => FlashBoardPromptRefineMediaFile | undefined;
  imageSize: string;
  isSunoMode: boolean;
  mode: string;
  multiShots: boolean;
  prompt: string;
  providerId: string;
  referenceBadges: FlashBoardPromptRefineReferenceBadge[];
  service: CatalogEntry['service'];
  sunoAudioWeight: number;
  sunoCustomMode: boolean;
  sunoInstrumental: boolean;
  sunoNegativeTags: string;
  sunoStyle: string;
  sunoStyleWeight: number;
  sunoVocalGender: string;
  sunoWeirdnessConstraint: number;
  version: string;
}

export function hasFlashBoardPromptRefineInput({
  isSunoMode,
  prompt,
  referenceCount,
  sunoNegativeTags,
  sunoStyle,
}: HasFlashBoardPromptRefineInputInput): boolean {
  return isSunoMode
    ? Boolean(prompt.trim() || sunoStyle.trim() || sunoNegativeTags.trim())
    : Boolean(prompt.trim() || referenceCount > 0);
}

export function buildFlashBoardPromptRefineInput({
  apiKey,
  aspectRatio,
  duration,
  entry,
  generateAudio,
  getMediaFile,
  imageSize,
  isSunoMode,
  mode,
  multiShots,
  prompt,
  providerId,
  referenceBadges,
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
}: BuildFlashBoardPromptRefineInputInput): RefineFlashBoardPromptInput {
  return {
    apiKey,
    prompt,
    entry,
    service,
    providerId,
    version,
    mode,
    duration,
    aspectRatio,
    imageSize,
    generateAudio,
    multiShots,
    sunoStyle,
    sunoNegativeTags,
    sunoInstrumental,
    sunoCustomMode,
    sunoVocalGender: sunoVocalGender || undefined,
    sunoStyleWeight,
    sunoWeirdnessConstraint,
    sunoAudioWeight,
    references: isSunoMode ? [] : referenceBadges.map((badge) => {
      const mediaFile = getMediaFile(badge.mediaFileId);

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
}

export function buildFlashBoardPromptRefineDeltaUpdate({
  fullText,
  isSunoMode,
  parsedSuno,
}: {
  fullText: string;
  isSunoMode: boolean;
  parsedSuno?: ParsedSunoPromptRefinement;
}): FlashBoardPromptRefineDeltaUpdate {
  if (!isSunoMode) {
    return {
      fields: { prompt: fullText },
      hasSunoFields: false,
    };
  }

  const fields: FlashBoardPromptRefineFieldUpdate = {};
  if (parsedSuno?.lyrics !== undefined) fields.prompt = parsedSuno.lyrics;
  if (parsedSuno?.style !== undefined) fields.sunoStyle = parsedSuno.style;
  if (parsedSuno?.negativeTags !== undefined) fields.sunoNegativeTags = parsedSuno.negativeTags;

  return {
    fields,
    hasSunoFields: Object.keys(fields).length > 0,
  };
}

export function buildFlashBoardPromptRefineFinalUpdate({
  isSunoMode,
  parsedSuno,
  refinedPrompt,
}: {
  isSunoMode: boolean;
  parsedSuno?: ParsedSunoPromptRefinement;
  refinedPrompt: string;
}): FlashBoardPromptRefineFieldUpdate {
  if (!isSunoMode) {
    return { prompt: refinedPrompt };
  }

  if (parsedSuno?.lyrics || parsedSuno?.style || parsedSuno?.negativeTags) {
    return {
      prompt: parsedSuno.lyrics ?? '',
      sunoCustomMode: true,
      sunoNegativeTags: parsedSuno.negativeTags ?? '',
      sunoStyle: parsedSuno.style ?? '',
    };
  }

  return { prompt: refinedPrompt };
}

export function buildFlashBoardPromptRefineErrorRestoreUpdate({
  isSunoMode,
  previousPrompt,
  previousSunoPrompt,
  streamedPrompt,
  streamedSunoFields,
}: {
  isSunoMode: boolean;
  previousPrompt: string;
  previousSunoPrompt: SunoPromptSnapshot;
  streamedPrompt: string;
  streamedSunoFields: boolean;
}): FlashBoardPromptRefineFieldUpdate | null {
  if (isSunoMode && (!streamedPrompt.trim() || !streamedSunoFields)) {
    return {
      prompt: previousSunoPrompt.prompt,
      sunoNegativeTags: previousSunoPrompt.negativeTags,
      sunoStyle: previousSunoPrompt.style,
    };
  }

  if (!streamedPrompt.trim()) {
    return { prompt: previousPrompt };
  }

  return null;
}

export function buildFlashBoardPromptRefineUndoRestoreUpdate({
  isSunoMode,
  promptBeforeAiRewrite,
  sunoBeforeAiRewrite,
}: {
  isSunoMode: boolean;
  promptBeforeAiRewrite: string | null;
  sunoBeforeAiRewrite: SunoPromptSnapshot | null;
}): FlashBoardPromptRefineFieldUpdate | null {
  if (isSunoMode && sunoBeforeAiRewrite) {
    return {
      prompt: sunoBeforeAiRewrite.prompt,
      sunoNegativeTags: sunoBeforeAiRewrite.negativeTags,
      sunoStyle: sunoBeforeAiRewrite.style,
    };
  }

  return promptBeforeAiRewrite !== null
    ? { prompt: promptBeforeAiRewrite }
    : null;
}
