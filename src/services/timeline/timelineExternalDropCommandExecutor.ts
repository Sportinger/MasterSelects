import type { Composition, MediaFile, SignalAssetItem } from '../../stores/mediaStore';
import type { AddClipOptions } from '../../stores/timeline/types';
import type { ShapePrimitive } from '../../types/motionDesign';
import type { TimelineExternalDropCommand } from '../../timeline';
import { createSignalTimelineAdapterPlan } from '../../runtime/renderers/signalTimelineRendererAdapter';
import { useMediaStore } from '../../stores/mediaStore';
import {
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
} from './timelineExternalDropMediaResolver';
import { Logger } from '../logger';

const log = Logger.create('TimelineExternalDropCommandExecutor');

export type TimelineExternalDropMediaFilePolicy =
  | 'strict-track-type'
  | 'allow-video-on-audio';

export interface TimelineExternalDropCommandExecutionActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addCompClip: (trackId: string, comp: Composition, startTime: number) => void | Promise<void>;
  addTextClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => Promise<string | null> | string | null | void;
  addSolidClip: (trackId: string, startTime: number, color?: string, duration?: number, skipMediaItem?: boolean) => string | null;
  addMeshClip: (trackId: string, startTime: number, meshType: import('../../stores/mediaStore/types').MeshPrimitiveType, duration?: number, skipMediaItem?: boolean) => string | null;
  addCameraClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addLightClip: (
    trackId: string,
    startTime: number,
    duration?: number,
    skipMediaItem?: boolean,
    lightSettings?: import('../../types/light').LightClipSettings,
    mediaItemId?: string,
  ) => string | null;
  addSplatEffectorClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMathSceneClip: (trackId: string, startTime: number, duration?: number, skipMediaItem?: boolean) => string | null;
  addMotionShapeClip: (trackId: string, startTime: number, options?: { primitive?: ShapePrimitive; duration?: number; name?: string }) => string | null;
  addSignalAssetClip: (trackId: string, signalAsset: SignalAssetItem, startTime: number) => Promise<string | null | undefined> | string | null | undefined;
}

export interface TimelineExternalDropCommandExecutionResult {
  handled: boolean;
  reason?: string;
}

export interface TimelineExternalDropCommandExecutionParams {
  actions: TimelineExternalDropCommandExecutionActions;
  command: TimelineExternalDropCommand;
  isAudioOnlyMediaFile: (mediaFile: MediaFile, file?: File) => boolean;
  isVideoTrack: boolean;
  mediaFilePolicy: TimelineExternalDropMediaFilePolicy;
  resolveStartTime: (duration?: number) => number;
  trackId: string;
}

function rejected(reason: string): TimelineExternalDropCommandExecutionResult {
  return { handled: true, reason };
}

function unhandled(): TimelineExternalDropCommandExecutionResult {
  return { handled: false };
}

function handled(): TimelineExternalDropCommandExecutionResult {
  return { handled: true };
}

function getCommandItemId(command: TimelineExternalDropCommand): string | undefined {
  return command.itemId || undefined;
}

async function executeMediaFileDropCommand(
  params: TimelineExternalDropCommandExecutionParams,
  mediaFileId: string,
): Promise<TimelineExternalDropCommandExecutionResult> {
  const mediaStore = useMediaStore.getState();
  const mediaFile = mediaStore.files.find((file) => file.id === mediaFileId);
  if (!mediaFile) {
    return rejected('missing-media-file');
  }

  const fileIsAudio = params.isAudioOnlyMediaFile(mediaFile, mediaFile.file);
  if (fileIsAudio && params.isVideoTrack) {
    log.debug('Audio files can only be dropped on audio tracks');
    return rejected('audio-file-on-video-track');
  }
  if (params.mediaFilePolicy === 'strict-track-type' && !fileIsAudio && !params.isVideoTrack) {
    log.debug('Video/image files can only be dropped on video tracks');
    return rejected('visual-media-on-audio-track');
  }

  const file = await resolveMediaFileForTimelineDrop(mediaFile);
  if (!file) {
    log.warn('Could not add media panel item to timeline because the file is not resolved', {
      mediaFileId,
      name: mediaFile.name,
    });
    return rejected('unresolved-media-file');
  }

  params.actions.addClip(
    params.trackId,
    file,
    params.resolveStartTime(mediaFile.duration),
    mediaFile.duration,
    mediaFileId,
    getTimelineDropMediaTypeOverride(mediaFile),
  );
  return handled();
}

export async function executeTimelineExternalDropCommand(
  params: TimelineExternalDropCommandExecutionParams,
): Promise<TimelineExternalDropCommandExecutionResult> {
  const { actions, command, isVideoTrack, resolveStartTime, trackId } = params;
  const itemId = getCommandItemId(command);

  if (command.kind === 'none' || command.kind === 'external-files') {
    return unhandled();
  }

  if (command.kind === 'media-file') {
    return itemId
      ? executeMediaFileDropCommand(params, itemId)
      : rejected('missing-media-file-id');
  }

  if (!isVideoTrack) {
    return rejected('visual-command-on-non-video-track');
  }

  const mediaStore = useMediaStore.getState();

  if (command.kind === 'composition' && itemId) {
    const comp = mediaStore.compositions.find((composition) => composition.id === itemId);
    if (!comp) return rejected('missing-composition');
    const duration = comp.timelineData?.duration ?? comp.duration ?? 5;
    await actions.addCompClip(trackId, comp, resolveStartTime(duration));
    return handled();
  }

  if (command.kind === 'text' && itemId) {
    const textItem = mediaStore.textItems.find((item) => item.id === itemId);
    if (!textItem) return rejected('missing-text-item');
    await actions.addTextClip(trackId, resolveStartTime(textItem.duration), textItem.duration, true);
    return handled();
  }

  if (command.kind === 'solid' && itemId) {
    const solidItem = mediaStore.solidItems.find((item) => item.id === itemId);
    if (!solidItem) return rejected('missing-solid-item');
    actions.addSolidClip(trackId, resolveStartTime(solidItem.duration), solidItem.color, solidItem.duration, true);
    return handled();
  }

  if (command.kind === 'mesh' && itemId) {
    const meshItem = mediaStore.meshItems.find((item) => item.id === itemId);
    if (!meshItem) return rejected('missing-mesh-item');
    actions.addMeshClip(trackId, resolveStartTime(meshItem.duration), meshItem.meshType, meshItem.duration, true);
    return handled();
  }

  if (command.kind === 'camera' && itemId) {
    const cameraItem = mediaStore.cameraItems.find((item) => item.id === itemId);
    if (!cameraItem) return rejected('missing-camera-item');
    actions.addCameraClip(trackId, resolveStartTime(cameraItem.duration), cameraItem.duration, true);
    return handled();
  }

  if (command.kind === 'light' && itemId) {
    const lightItem = mediaStore.lightItems.find((item) => item.id === itemId);
    if (!lightItem) return rejected('missing-light-item');
    actions.addLightClip(trackId, resolveStartTime(lightItem.duration), lightItem.duration, true, lightItem.lightSettings, lightItem.id);
    return handled();
  }

  if (command.kind === 'splat-effector' && itemId) {
    const effectorItem = mediaStore.splatEffectorItems.find((item) => item.id === itemId);
    if (!effectorItem) return rejected('missing-splat-effector-item');
    actions.addSplatEffectorClip(trackId, resolveStartTime(effectorItem.duration), effectorItem.duration, true);
    return handled();
  }

  if (command.kind === 'math-scene' && itemId) {
    const mathSceneItem = mediaStore.mathSceneItems.find((item) => item.id === itemId);
    if (!mathSceneItem) return rejected('missing-math-scene-item');
    actions.addMathSceneClip(trackId, resolveStartTime(mathSceneItem.duration), mathSceneItem.duration, true);
    return handled();
  }

  if (command.kind === 'motion-shape' && itemId) {
    const motionShapeItem = mediaStore.motionShapeItems.find((item) => item.id === itemId);
    if (!motionShapeItem) return rejected('missing-motion-shape-item');
    actions.addMotionShapeClip(trackId, resolveStartTime(motionShapeItem.duration), {
      primitive: motionShapeItem.primitive,
      duration: motionShapeItem.duration,
      name: motionShapeItem.name,
    });
    return handled();
  }

  if (command.kind === 'signal-asset' && itemId) {
    const signalAsset = mediaStore.signalAssets.find((item) => item.id === itemId);
    if (!signalAsset) return rejected('missing-signal-asset');
    const plan = createSignalTimelineAdapterPlan(signalAsset);
    await actions.addSignalAssetClip(trackId, signalAsset, resolveStartTime(plan.duration));
    return handled();
  }

  return rejected('missing-command-item-id');
}
