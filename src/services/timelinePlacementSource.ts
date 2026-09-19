import { createSignalTimelineAdapterPlan } from '../runtime/renderers/signalTimelineRendererAdapter';
import { useMediaStore } from '../stores/mediaStore';
import type {
  CameraItem,
  LightItem,
  Composition,
  MathSceneItem,
  MediaFile,
  MeshItem,
  MotionShapeItem,
  SignalAssetItem,
  SolidItem,
  SplatEffectorItem,
  TextItem,
} from '../stores/mediaStore';
import { NativeHelperClient } from './nativeHelper/NativeHelperClient';
import { createPrimaryMediaObjectUrl } from './project/mediaObjectUrlManager';
import { Logger } from './logger';

const log = Logger.create('TimelinePlacementCommands');
const DEFAULT_SOURCE_DURATION = 5;
const DEFAULT_3D_SOURCE_DURATION = 10;
const EPSILON = 0.001;

export type TimelinePlacementSource =
  | { kind: 'media-file'; item: MediaFile; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video' | 'audio'; hasAudio: boolean }
  | { kind: 'composition'; item: Composition; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: boolean }
  | { kind: 'text'; item: TextItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'solid'; item: SolidItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'mesh'; item: MeshItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'camera'; item: CameraItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'light'; item: LightItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'splat-effector'; item: SplatEffectorItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'math-scene'; item: MathSceneItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'motion-shape'; item: MotionShapeItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false }
  | { kind: 'signal'; item: SignalAssetItem; duration: number; naturalDuration: number; sourceInPoint: number; trackType: 'video'; hasAudio: false };

function finiteDuration(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > EPSILON ? value : fallback;
}

export function getTimelineMediaTypeOverride(mediaFile: MediaFile): string | undefined {
  return ['gaussian-splat', 'lottie', 'rive', 'model'].includes(mediaFile.type)
    ? mediaFile.type
    : undefined;
}

function getPlaceholderMimeType(mediaFile: MediaFile): string {
  const name = mediaFile.name.toLowerCase();

  if (mediaFile.type === 'model') {
    if (name.endsWith('.glb')) return 'model/gltf-binary';
    if (name.endsWith('.gltf')) return 'model/gltf+json';
    if (name.endsWith('.obj')) return 'model/obj';
  }

  if (mediaFile.type === 'gaussian-splat') {
    return 'application/octet-stream';
  }

  return '';
}

function createPlaceholderFileForMedia(mediaFile: MediaFile): File {
  const file = new File([], mediaFile.name, { type: getPlaceholderMimeType(mediaFile) });
  const path = mediaFile.absolutePath ?? mediaFile.filePath;
  if (path) {
    (file as File & { path?: string }).path = path;
  }
  return file;
}

function mediaFileHasLazy3DSource(mediaFile: MediaFile): boolean {
  if (mediaFile.file || mediaFile.url || mediaFile.absolutePath || mediaFile.projectPath) {
    return true;
  }

  if (mediaFile.modelSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.modelUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  )) {
    return true;
  }

  return Boolean(mediaFile.gaussianSplatSequence?.frames.some((frame) =>
    Boolean(frame.file || frame.splatUrl || frame.absolutePath || frame.projectPath || frame.sourcePath)
  ));
}

export async function resolveMediaFileForTimeline(mediaFile: MediaFile): Promise<File | null> {
  if (mediaFile.file) {
    return mediaFile.file;
  }

  if (mediaFile.type === 'model' || mediaFile.type === 'gaussian-splat') {
    return mediaFileHasLazy3DSource(mediaFile) ? createPlaceholderFileForMedia(mediaFile) : null;
  }

  const nativeReferenceUrl = NativeHelperClient.parseFileReferenceUrl(mediaFile.url)
    ? mediaFile.url
    : mediaFile.absolutePath
      ? NativeHelperClient.getFileReferenceUrl(mediaFile.absolutePath)
      : null;

  if (!nativeReferenceUrl) {
    return null;
  }

  try {
    const file = await NativeHelperClient.getReferencedFile(nativeReferenceUrl, mediaFile.name);
    if (!file) return null;

    const referencedPath = NativeHelperClient.parseFileReferenceUrl(nativeReferenceUrl) ?? mediaFile.absolutePath;
    if (referencedPath) {
      (file as File & { path?: string }).path = referencedPath;
    }
    const url = createPrimaryMediaObjectUrl(mediaFile.id, file);

    useMediaStore.setState((state) => ({
      files: state.files.map((currentFile) =>
        currentFile.id === mediaFile.id
          ? {
              ...currentFile,
              file,
              url,
              hasFileHandle: true,
              absolutePath: currentFile.absolutePath ?? referencedPath ?? undefined,
            }
          : currentFile
      ),
    }));

    return file;
  } catch (error) {
    log.warn('Could not resolve media source for placement command', {
      mediaFileId: mediaFile.id,
      name: mediaFile.name,
      error,
    });
    return null;
  }
}

function applySourceRange(duration: number, range?: { inPoint: number | null; outPoint: number | null }): { duration: number; sourceInPoint: number } {
  if (!range) {
    return { duration, sourceInPoint: 0 };
  }

  const inPoint = Math.max(0, Math.min(range.inPoint ?? 0, duration));
  const outPoint = Math.max(inPoint, Math.min(range.outPoint ?? duration, duration));
  if (outPoint - inPoint <= EPSILON) {
    return { duration, sourceInPoint: 0 };
  }

  return { duration: outPoint - inPoint, sourceInPoint: inPoint };
}

function sourceFromMediaFile(item: MediaFile, range?: { inPoint: number | null; outPoint: number | null }): TimelinePlacementSource {
  const isAudio = item.type === 'audio';
  const naturalDuration = finiteDuration(item.duration, item.type === 'image' ? DEFAULT_SOURCE_DURATION : DEFAULT_SOURCE_DURATION);
  const sourceRange = applySourceRange(naturalDuration, range);
  return {
    kind: 'media-file',
    item,
    duration: sourceRange.duration,
    naturalDuration,
    sourceInPoint: sourceRange.sourceInPoint,
    trackType: isAudio ? 'audio' : 'video',
    hasAudio: isAudio ? true : item.type === 'image' ? false : item.hasAudio !== false,
  };
}

function findSourceById(id: string, range?: { inPoint: number | null; outPoint: number | null }): TimelinePlacementSource | null {
  const media = useMediaStore.getState();
  const mediaFile = media.files.find((item) => item.id === id);
  if (mediaFile) return sourceFromMediaFile(mediaFile, range);

  const composition = media.compositions.find((item) => item.id === id);
  if (composition) {
    const naturalDuration = finiteDuration(composition.timelineData?.duration ?? composition.duration, DEFAULT_SOURCE_DURATION);
    const sourceRange = applySourceRange(naturalDuration, range);
    return {
      kind: 'composition',
      item: composition,
      duration: sourceRange.duration,
      naturalDuration,
      sourceInPoint: sourceRange.sourceInPoint,
      trackType: 'video',
      hasAudio: true,
    };
  }

  const text = media.textItems.find((item) => item.id === id);
  if (text) {
    const duration = finiteDuration(text.duration, DEFAULT_SOURCE_DURATION);
    return { kind: 'text', item: text, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const solid = media.solidItems.find((item) => item.id === id);
  if (solid) {
    const duration = finiteDuration(solid.duration, DEFAULT_SOURCE_DURATION);
    return { kind: 'solid', item: solid, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const mesh = media.meshItems.find((item) => item.id === id);
  if (mesh) {
    const duration = finiteDuration(mesh.duration, DEFAULT_3D_SOURCE_DURATION);
    return { kind: 'mesh', item: mesh, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const camera = media.cameraItems.find((item) => item.id === id);
  if (camera) {
    const duration = finiteDuration(camera.duration, DEFAULT_3D_SOURCE_DURATION);
    return { kind: 'camera', item: camera, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const light = media.lightItems.find((item) => item.id === id);
  if (light) {
    const duration = finiteDuration(light.duration, DEFAULT_3D_SOURCE_DURATION);
    return { kind: 'light', item: light, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const splatEffector = media.splatEffectorItems.find((item) => item.id === id);
  if (splatEffector) {
    const duration = finiteDuration(splatEffector.duration, DEFAULT_3D_SOURCE_DURATION);
    return { kind: 'splat-effector', item: splatEffector, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const mathScene = media.mathSceneItems.find((item) => item.id === id);
  if (mathScene) {
    const duration = finiteDuration(mathScene.duration, DEFAULT_SOURCE_DURATION);
    return { kind: 'math-scene', item: mathScene, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const motionShape = media.motionShapeItems.find((item) => item.id === id);
  if (motionShape) {
    const duration = finiteDuration(motionShape.duration, DEFAULT_SOURCE_DURATION);
    return { kind: 'motion-shape', item: motionShape, duration, naturalDuration: duration, sourceInPoint: 0, trackType: 'video', hasAudio: false };
  }

  const signal = media.signalAssets.find((item) => item.id === id);
  if (signal) {
    const duration = createSignalTimelineAdapterPlan(signal).duration;
    return {
      kind: 'signal',
      item: signal,
      duration,
      naturalDuration: duration,
      sourceInPoint: 0,
      trackType: 'video',
      hasAudio: false,
    };
  }

  return null;
}

export function resolveCurrentTimelinePlacementSource(): TimelinePlacementSource | null {
  const media = useMediaStore.getState();

  if (media.sourceMonitorFileId) {
    const source = findSourceById(media.sourceMonitorFileId, {
      inPoint: media.sourceMonitorInPoint,
      outPoint: media.sourceMonitorOutPoint,
    });
    if (source) return source;
  }

  for (const id of media.selectedIds) {
    const source = findSourceById(id);
    if (source) return source;
  }

  return null;
}

export function hasCurrentTimelinePlacementSource(): boolean {
  return resolveCurrentTimelinePlacementSource() !== null;
}

export function getPlacementSourceName(source: TimelinePlacementSource): string {
  return 'name' in source.item && typeof source.item.name === 'string'
    ? source.item.name
    : source.kind;
}
