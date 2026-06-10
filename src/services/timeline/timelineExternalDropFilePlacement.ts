import type { MediaFile, SignalAssetItem } from '../../stores/mediaStore';
import type { AddClipOptions } from '../../stores/timeline/types';
import { classifyMediaType } from '../../stores/timeline/helpers/mediaTypeHelpers';
import { createSignalTimelineAdapterPlan } from '../../runtime/renderers/signalTimelineRendererAdapter';
import {
  getTimelineDropMediaTypeOverride,
  resolveTimelineDropImportResult,
  resolveTimelineDropMediaFile,
  setTimelineDroppedFilePath,
} from './timelineExternalDropMediaResolver';
import { Logger } from '../logger';

const log = Logger.create('TimelineExternalDropFilePlacement');

export interface TimelineExternalDropFileRecord {
  file: File;
  handle?: FileSystemFileHandle;
  absolutePath?: string;
}

export interface TimelineExternalDropFilePlacementActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addSignalAssetClip: (
    trackId: string,
    signalAsset: SignalAssetItem,
    startTime: number,
  ) => Promise<string | null | undefined> | string | null | undefined;
}

export interface PlaceTimelineExternalDropFilesParams {
  actions: TimelineExternalDropFilePlacementActions;
  baseStartTime: number;
  fallbackDuration?: number;
  filePath?: string;
  records: TimelineExternalDropFileRecord[];
  resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  trackId: string;
  trackIsVideo: boolean;
}

interface TimelineExternalDropClipPlacement {
  startTime: number;
  endTime: number;
}

async function addTimelineExternalDropMediaClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  duration?: number;
  file: File;
  filePath?: string;
  handle?: FileSystemFileHandle;
  startTime: number;
  trackId: string;
  typeOverride?: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    duration,
    file,
    filePath,
    handle,
    startTime,
    trackId,
    typeOverride,
  } = params;

  const mediaFile: MediaFile | null = await resolveTimelineDropMediaFile({
    file,
    handle,
    absolutePath: filePath,
  });

  if (!mediaFile) {
    log.warn('Could not import timeline drop media before creating clip', {
      name: file.name,
      filePath,
    });
    return null;
  }

  const timelineFile = mediaFile.file ?? file;
  setTimelineDroppedFilePath(timelineFile, mediaFile.absolutePath ?? filePath);
  const resolvedDuration = mediaFile.duration ?? duration;

  const clipId = await actions.addClip(
    trackId,
    timelineFile,
    startTime,
    resolvedDuration,
    mediaFile.id,
    getTimelineDropMediaTypeOverride(mediaFile) ?? typeOverride,
  );
  if (!clipId) {
    log.warn('Could not place timeline drop media clip', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      trackId,
    });
    return null;
  }

  return { startTime, endTime: startTime + (resolvedDuration ?? 5) };
}

async function addTimelineExternalDropSignalClip(params: {
  actions: TimelineExternalDropFilePlacementActions;
  desiredStartTime: number;
  duration?: number;
  file: File;
  filePath?: string;
  handle?: FileSystemFileHandle;
  resolveStartTime?: (desiredStartTime: number, duration?: number) => number;
  trackId: string;
}): Promise<TimelineExternalDropClipPlacement | null> {
  const {
    actions,
    desiredStartTime,
    duration,
    file,
    filePath,
    handle,
    resolveStartTime,
    trackId,
  } = params;

  const importResult = await resolveTimelineDropImportResult({
    file,
    handle,
    absolutePath: filePath,
    waitForMediaPlaceholder: false,
  });

  if (!importResult) {
    log.warn('Could not import timeline drop file before creating signal clip', {
      name: file.name,
      filePath,
    });
    return null;
  }

  if (importResult.kind === 'media-file') {
    const mediaFile = importResult.mediaFile;
    const timelineFile = mediaFile.file ?? file;
    setTimelineDroppedFilePath(timelineFile, mediaFile.absolutePath ?? filePath);
    const resolvedDuration = mediaFile.duration ?? duration ?? 5;
    const startTime = resolveStartTime
      ? resolveStartTime(desiredStartTime, resolvedDuration)
      : desiredStartTime;

    const clipId = await actions.addClip(
      trackId,
      timelineFile,
      startTime,
      resolvedDuration,
      mediaFile.id,
      getTimelineDropMediaTypeOverride(mediaFile),
    );
    if (!clipId) {
      log.warn('Could not place timeline drop media clip for signal import result', {
        mediaFileId: mediaFile.id,
        name: mediaFile.name,
        trackId,
      });
      return null;
    }

    return { startTime, endTime: startTime + resolvedDuration };
  }

  const signalAsset = importResult.signalAsset;
  const plan = createSignalTimelineAdapterPlan(signalAsset);
  const startTime = resolveStartTime
    ? resolveStartTime(desiredStartTime, plan.duration)
    : desiredStartTime;
  const clipId = await actions.addSignalAssetClip(trackId, signalAsset, startTime);

  if (!clipId) {
    log.warn('Could not place timeline drop signal asset', {
      signalAssetId: signalAsset.id,
      name: signalAsset.name,
    });
    return null;
  }

  return { startTime, endTime: startTime + plan.duration };
}

export async function placeTimelineExternalDropFiles(
  params: PlaceTimelineExternalDropFilesParams,
): Promise<boolean> {
  const {
    actions,
    baseStartTime,
    fallbackDuration,
    filePath,
    records,
    resolveStartTime,
    trackId,
    trackIsVideo,
  } = params;

  if (records.length === 0) return false;

  let cursorTime = baseStartTime;
  let placedAny = false;

  for (const record of records) {
    const { file, handle, absolutePath } = record;
    setTimelineDroppedFilePath(file, absolutePath ?? filePath);

    const typeOverride = await classifyMediaType(file);
    if (typeOverride === 'unknown') {
      if (!trackIsVideo) {
        log.debug('Skipping signal file dropped on a non-video track', { name: file.name });
        continue;
      }

      const placement = await addTimelineExternalDropSignalClip({
        actions,
        trackId,
        file,
        desiredStartTime: cursorTime,
        duration: fallbackDuration,
        filePath: absolutePath ?? filePath,
        handle,
        resolveStartTime,
      });

      if (placement) {
        placedAny = true;
        cursorTime = placement.endTime;
      }
      continue;
    }

    const fileIsAudio = typeOverride === 'audio';
    if (fileIsAudio && trackIsVideo) {
      log.debug('Skipping audio file dropped on a video track', { name: file.name });
      continue;
    }
    if (!fileIsAudio && !trackIsVideo) {
      log.debug('Skipping non-audio file dropped on an audio track', { name: file.name });
      continue;
    }

    const startTime = resolveStartTime
      ? resolveStartTime(cursorTime, fallbackDuration)
      : cursorTime;

    const placement = await addTimelineExternalDropMediaClip({
      actions,
      trackId,
      file,
      startTime,
      duration: fallbackDuration,
      filePath: absolutePath ?? filePath,
      handle,
      typeOverride,
    });

    if (placement) {
      placedAny = true;
      cursorTime = placement.endTime;
    }
  }

  return placedAny;
}
