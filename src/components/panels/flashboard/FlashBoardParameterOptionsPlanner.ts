import {
  getFlashBoardPriceEstimate,
} from '../../../services/flashboard/FlashBoardPricing';
import type {
  FlashBoardOutputType,
  FlashBoardService,
} from '../../../stores/flashboardStore/types';

type FlashBoardParameterPopover = 'aspect' | 'duration' | 'imageSize' | 'mode';
const RUNWAY_VIDEO_PROVIDER_ID = 'runway-video';

export interface FlashBoardParameterOption {
  id: string;
  label: string;
  active: boolean;
  meta?: string;
}

export interface FlashBoardDurationParameterOption extends FlashBoardParameterOption {
  value: number;
}

interface FlashBoardParameterOptionsEntry {
  aspectRatios: string[];
  durations: number[];
  imageSizes?: string[];
  modes: string[];
  modeLabels?: Record<string, string>;
  outputType?: FlashBoardOutputType;
}

interface BuildFlashBoardParameterOptionsInput {
  activePopover: string | null;
  aspectRatio: string;
  duration: number;
  effectiveGenerateAudio: boolean;
  hasVideoReferenceInput: boolean;
  imageSize: string;
  mode: string;
  multiShots: boolean;
  providerId: string;
  selectedEntry: FlashBoardParameterOptionsEntry | null | undefined;
  service: FlashBoardService;
}

export interface FlashBoardParameterOptionsState {
  aspectOptions: FlashBoardParameterOption[];
  durationOptions: FlashBoardDurationParameterOption[];
  imageSizeOptions: FlashBoardParameterOption[];
  modeOptions: FlashBoardParameterOption[];
}

function isParameterPopover(activePopover: string | null, expected: FlashBoardParameterPopover): boolean {
  return activePopover === expected;
}

function buildPriceMeta({
  duration,
  effectiveGenerateAudio,
  hasVideoReferenceInput,
  imageSize,
  mode,
  multiShots,
  outputType,
  providerId,
  service,
}: {
  duration: number;
  effectiveGenerateAudio: boolean;
  hasVideoReferenceInput: boolean;
  imageSize: string;
  mode: string;
  multiShots: boolean;
  outputType?: FlashBoardOutputType;
  providerId: string;
  service: FlashBoardService;
}): string | undefined {
  return getFlashBoardPriceEstimate({
    service,
    providerId,
    outputType,
    mode,
    duration,
    imageSize,
    generateAudio: effectiveGenerateAudio,
    multiShots,
    hasVideoInput: hasVideoReferenceInput,
  })?.compactLabel;
}

function getEffectiveDurationOptions(
  entry: FlashBoardParameterOptionsEntry,
  providerId: string,
  mode: string,
): number[] {
  if (providerId === RUNWAY_VIDEO_PROVIDER_ID && mode === '1080p') {
    return entry.durations.filter((optionDuration) => optionDuration !== 10);
  }

  return entry.durations;
}

function getEffectiveModeOptions(
  entry: FlashBoardParameterOptionsEntry,
  providerId: string,
  duration: number,
): string[] {
  if (providerId === RUNWAY_VIDEO_PROVIDER_ID && duration === 10) {
    return entry.modes.filter((optionMode) => optionMode !== '1080p');
  }

  return entry.modes;
}

export function buildFlashBoardParameterOptions({
  activePopover,
  aspectRatio,
  duration,
  effectiveGenerateAudio,
  hasVideoReferenceInput,
  imageSize,
  mode,
  multiShots,
  providerId,
  selectedEntry,
  service,
}: BuildFlashBoardParameterOptionsInput): FlashBoardParameterOptionsState {
  const effectiveDurationOptions = selectedEntry
    ? getEffectiveDurationOptions(selectedEntry, providerId, mode)
    : [];
  const effectiveModeOptions = selectedEntry
    ? getEffectiveModeOptions(selectedEntry, providerId, duration)
    : [];

  return {
    aspectOptions: isParameterPopover(activePopover, 'aspect') && selectedEntry
      ? selectedEntry.aspectRatios.map((ratio) => ({
        id: ratio,
        label: ratio,
        active: aspectRatio === ratio,
      }))
      : [],
    durationOptions: isParameterPopover(activePopover, 'duration') && selectedEntry
      ? effectiveDurationOptions.map((optionDuration) => ({
        id: String(optionDuration),
        value: optionDuration,
        label: `${optionDuration}s`,
        active: duration === optionDuration,
        meta: buildPriceMeta({
          duration: optionDuration,
          effectiveGenerateAudio,
          hasVideoReferenceInput,
          imageSize,
          mode,
          multiShots,
          outputType: selectedEntry.outputType,
          providerId,
          service,
        }),
      }))
      : [],
    imageSizeOptions: isParameterPopover(activePopover, 'imageSize') && selectedEntry?.imageSizes?.length
      ? selectedEntry.imageSizes.map((optionImageSize) => ({
        id: optionImageSize,
        label: optionImageSize,
        active: imageSize === optionImageSize,
        meta: buildPriceMeta({
          duration,
          effectiveGenerateAudio,
          hasVideoReferenceInput,
          imageSize: optionImageSize,
          mode,
          multiShots,
          outputType: selectedEntry.outputType,
          providerId,
          service,
        }),
      }))
      : [],
    modeOptions: isParameterPopover(activePopover, 'mode') && selectedEntry
      ? effectiveModeOptions.map((optionMode) => ({
        id: optionMode,
        label: selectedEntry.modeLabels?.[optionMode] ?? optionMode,
        active: mode === optionMode,
        meta: buildPriceMeta({
          duration,
          effectiveGenerateAudio,
          hasVideoReferenceInput,
          imageSize,
          mode: optionMode,
          multiShots,
          outputType: selectedEntry.outputType,
          providerId,
          service,
        }),
      }))
      : [],
  };
}
