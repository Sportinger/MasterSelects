import type { TimelineClip } from '../types/timeline';
import { loadModelRuntime } from '../engine/native3d/assets/modelRuntimeCache/loadRuntime';
import { computeModelVolumeCenter } from '../engine/native3d/assets/modelVolumeCenter';
import { waitForTargetPreparedSplatRuntime } from '../engine/scene/runtime/SharedSplatRuntimeCache';
import {
  buildSharedSplatRuntimeRequest,
  getUsableSplatFile,
} from '../engine/scene/runtime/SharedSplatRuntimeUtils';
import { computeSplatVolumeCenter } from '../engine/scene/runtime/splatVolumeCenter';
import { getSplatOrientationMatrix } from '../engine/scene/SceneTransformUtils';
import { Logger } from './logger';

const log = Logger.create('OriginCenter');

export interface ThreeDOriginCenter {
  x: number;
  y: number;
  z: number;
}

export function supportsOriginToCenter(clip: TimelineClip | null | undefined): boolean {
  return clip?.source?.type === 'model' || clip?.source?.type === 'gaussian-splat';
}

async function resolveModelCenter(clip: TimelineClip): Promise<ThreeDOriginCenter> {
  const source = clip.source;
  if (!source || source.meshType) return { x: 0, y: 0, z: 0 };
  const sequenceFrame = source.modelSequence?.frames[0];
  const file = sequenceFrame?.file ?? source.file ?? clip.file;
  let url = sequenceFrame?.modelUrl ?? source.modelUrl;
  let temporaryUrl: string | undefined;
  if (!url && file) {
    temporaryUrl = URL.createObjectURL(file);
    url = temporaryUrl;
  }
  if (!url) throw new Error('The model source is not loaded.');
  const fileName = sequenceFrame?.name ?? source.modelFileName ?? file?.name ?? clip.name;
  try {
    const runtime = await loadModelRuntime(url, fileName);
    if (!runtime) throw new Error('The model geometry could not be read.');
    const center = computeModelVolumeCenter(runtime.primitives, source.modelPrimitiveIndex);
    for (const primitive of runtime.primitives) primitive.baseColorTexture?.image.close();
    return center;
  } finally {
    if (temporaryUrl) URL.revokeObjectURL(temporaryUrl);
  }
}

async function resolveSplatCenter(clip: TimelineClip): Promise<ThreeDOriginCenter> {
  const source = clip.source;
  if (!source) throw new Error('The Gaussian Splat source is not loaded.');
  const firstFrame = source.gaussianSplatSequence?.frames[0];
  const request = buildSharedSplatRuntimeRequest({
    clipId: clip.id,
    runtimeKey: source.gaussianSplatRuntimeKey,
    url: firstFrame?.splatUrl ?? source.gaussianSplatUrl,
    file: getUsableSplatFile(firstFrame?.file, source.file, clip.file),
    fileName: firstFrame?.name ?? source.gaussianSplatFileName ?? clip.file?.name ?? clip.name,
    fileHash: source.gaussianSplatFileHash,
    mediaFileId: source.mediaFileId ?? clip.mediaFileId,
    gaussianSplatSequence: source.gaussianSplatSequence,
    gaussianSplatSettings: source.gaussianSplatSettings,
    requestedMaxSplats: 0,
  });
  const runtime = await waitForTargetPreparedSplatRuntime({
    cacheKey: request.cacheKey,
    fileHash: request.fileHash,
    file: request.file,
    url: request.url,
    fileName: request.fileName,
    gaussianSplatSequence: request.gaussianSplatSequence,
    requestedMaxSplats: 0,
  });
  const center = computeSplatVolumeCenter(runtime);
  const orientation = getSplatOrientationMatrix(source.gaussianSplatSettings?.render.orientationPreset);
  if (!orientation) return center;
  return {
    x: orientation[0] * center.x + orientation[4] * center.y + orientation[8] * center.z,
    y: orientation[1] * center.x + orientation[5] * center.y + orientation[9] * center.z,
    z: orientation[2] * center.x + orientation[6] * center.y + orientation[10] * center.z,
  };
}

export async function resolveThreeDOriginCenter(clip: TimelineClip): Promise<ThreeDOriginCenter> {
  if (clip.source?.type === 'model') {
    const center = await resolveModelCenter(clip);
    log.info('Resolved model center', { clipId: clip.id, center });
    return center;
  }
  if (clip.source?.type === 'gaussian-splat') {
    const center = await resolveSplatCenter(clip);
    log.info('Resolved Gaussian Splat center', { clipId: clip.id, center });
    return center;
  }
  throw new Error('This clip has no centerable 3D geometry.');
}
