import { DEFAULT_ELEVENLABS_MODEL_ID } from '../../../stores/flashboardStore/defaults';
import {
  ELEVENLABS_MP3_OUTPUT_FORMATS,
  type ElevenLabsModel,
  type ElevenLabsModelRates,
  type ElevenLabsMp3OutputFormat,
  type ElevenLabsVoice,
} from '../../../services/elevenLabsService';

export interface FlashBoardElevenLabsModelOption {
  modelId: string;
  name: string;
  description?: string;
  maximumTextLengthPerRequest?: number;
  maxCharactersRequestFreeUser?: number;
  maxCharactersRequestSubscribedUser?: number;
  modelRates?: ElevenLabsModelRates;
}

export interface FlashBoardElevenLabsSelectOption {
  id: string;
  label: string;
}

export interface FlashBoardElevenLabsVoiceOption {
  id: string;
  name: string;
  meta: string;
  previewUrl?: string;
}

interface BuildFlashBoardElevenLabsOptionsStateInput {
  elevenLabsModels: ElevenLabsModel[];
  elevenLabsModelsError: string | null;
  elevenLabsVoices: ElevenLabsVoice[];
  isLoadingElevenLabsModels: boolean;
  outputFormat: ElevenLabsMp3OutputFormat;
  version: string;
}

export interface FlashBoardElevenLabsOptionsState {
  audioModelButtonLabel: string;
  audioOutputButtonLabel: string;
  modelMetaText: string | undefined;
  modelOptions: FlashBoardElevenLabsSelectOption[];
  outputOptions: FlashBoardElevenLabsSelectOption[];
  selectedModel: FlashBoardElevenLabsModelOption | undefined;
  selectedModelCharacterLimit: number | null;
  voiceOptions: FlashBoardElevenLabsVoiceOption[];
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

function buildElevenLabsModelOptions(models: ElevenLabsModel[]): FlashBoardElevenLabsModelOption[] {
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

function getElevenLabsModelCharacterLimit(model: FlashBoardElevenLabsModelOption | undefined): number | null {
  if (!model) {
    return null;
  }

  return model.maximumTextLengthPerRequest
    ?? model.maxCharactersRequestSubscribedUser
    ?? model.maxCharactersRequestFreeUser
    ?? null;
}

export function findFlashBoardElevenLabsVoiceById(
  voices: ElevenLabsVoice[],
  voiceId: string,
): ElevenLabsVoice | undefined {
  return voices.find((voice) => voice.voiceId === voiceId);
}

export function buildFlashBoardElevenLabsOptionsState({
  elevenLabsModels,
  elevenLabsModelsError,
  elevenLabsVoices,
  isLoadingElevenLabsModels,
  outputFormat,
  version,
}: BuildFlashBoardElevenLabsOptionsStateInput): FlashBoardElevenLabsOptionsState {
  const modelOptions = buildElevenLabsModelOptions(elevenLabsModels);
  const selectedModel = modelOptions.find((model) => model.modelId === version) ?? modelOptions[0];

  return {
    audioModelButtonLabel: (selectedModel?.name ?? version).replace(/^Eleven\s+/i, ''),
    audioOutputButtonLabel: ELEVENLABS_OUTPUT_FORMAT_COMPACT_LABELS[outputFormat],
    modelMetaText: isLoadingElevenLabsModels
      ? 'Loading models...'
      : elevenLabsModelsError
        ? elevenLabsModelsError
        : selectedModel?.description ?? selectedModel?.modelId,
    modelOptions: modelOptions.map((model) => ({
      id: model.modelId,
      label: model.name,
    })),
    outputOptions: ELEVENLABS_MP3_OUTPUT_FORMATS.map((format) => ({
      id: format,
      label: ELEVENLABS_OUTPUT_FORMAT_LABELS[format],
    })),
    selectedModel,
    selectedModelCharacterLimit: getElevenLabsModelCharacterLimit(selectedModel),
    voiceOptions: elevenLabsVoices.map((voice) => ({
      id: voice.voiceId,
      name: voice.name,
      meta: voice.category ?? voice.labels.gender ?? voice.labels.accent ?? voice.voiceId,
      previewUrl: voice.previewUrl,
    })),
  };
}
