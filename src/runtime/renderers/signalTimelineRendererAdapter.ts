import { artifactService } from '../../services/project/domains/ArtifactService';
import { projectFileService } from '../../services/projectFileService';
import type { SignalArtifact, SignalKind, SignalMetadata, SignalRef } from '../../signals';
import type { SignalAssetItem } from '../../stores/mediaStore';
import type { AddClipOptions } from '../../stores/timeline/types';
import { isGaussianSplatFile, isModelFile } from '../../stores/timeline/helpers/mediaTypeHelpers';
import type { TextClipProperties, TimelineClip } from '../../types';
import {
  createSignalTimelineRenderPlan,
  SIGNAL_TEXT_RENDERER_ADAPTER_ID,
  type SignalTimelineRenderPlan as SignalTextTimelineRenderPlan,
} from './signalTextRendererAdapter';

export const SIGNAL_MODEL_RENDERER_ADAPTER_ID = 'masterselects.renderer.signal-model';
export const SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID = 'masterselects.renderer.signal-gaussian-splat';

const SIGNAL_MODEL_RENDERER_DEFAULT_DURATION = 10;
const SIGNAL_GAUSSIAN_SPLAT_RENDERER_DEFAULT_DURATION = 30;

type SignalFileMediaType = 'model' | 'gaussian-splat';

interface SignalTimelineFileRenderPlan {
  kind: 'file';
  adapterId: typeof SIGNAL_MODEL_RENDERER_ADAPTER_ID | typeof SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID;
  mediaTypeOverride: SignalFileMediaType;
  clipName: string;
  duration: number;
  signalAssetId: string;
  signalRefId?: string;
  artifactId: string;
  artifactHash?: string;
  fileName: string;
  mimeType: string;
}

export type SignalTimelineAdapterPlan =
  | ({ kind: 'text' } & SignalTextTimelineRenderPlan)
  | SignalTimelineFileRenderPlan;

export interface SignalTimelinePlacementActions {
  addClip: (
    trackId: string,
    file: File,
    startTime: number,
    duration?: number,
    mediaFileId?: string,
    mediaTypeOverride?: string,
    options?: AddClipOptions,
  ) => Promise<string | undefined> | string | undefined | void;
  addTextClip: (
    trackId: string,
    startTime: number,
    duration?: number,
    skipMediaItem?: boolean,
  ) => Promise<string | null> | string | null;
  updateTextProperties: (clipId: string, props: Partial<TextClipProperties>) => void;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

export interface SignalTimelinePlacementResult {
  clipId: string | null;
  plan: SignalTimelineAdapterPlan;
  fallbackReason?: string;
}

interface SignalArtifactCandidate {
  ref: SignalRef;
  artifact: SignalArtifact;
  fileName: string;
  mimeType: string;
}

function metadataString(metadata: SignalMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mergeMetadata(...metadata: Array<SignalMetadata | undefined>): SignalMetadata {
  return Object.assign({}, ...metadata.filter(Boolean));
}

function normalizeExtension(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^\./, '').toLowerCase();
  return normalized || undefined;
}

function fileExtension(fileName: string | undefined): string | undefined {
  if (!fileName) return undefined;
  const lastPart = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = lastPart.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === lastPart.length - 1) return undefined;
  return normalizeExtension(lastPart.slice(dotIndex + 1));
}

function withoutKnownExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0) return fileName;
  return fileName.slice(0, dotIndex);
}

function normalizeFileName(value: string | undefined): string | undefined {
  const name = value?.split(/[\\/]/).pop()?.trim();
  return name || undefined;
}

function getArtifactById(item: SignalAssetItem, artifactId: string | undefined): SignalArtifact | undefined {
  if (!artifactId) return undefined;
  return (
    item.artifacts.find((artifact) => artifact.artifactId === artifactId) ??
    item.asset.artifacts.find((artifact) => artifact.artifactId === artifactId)
  );
}

function getRefArtifactCandidates(item: SignalAssetItem, kinds: readonly SignalKind[]): SignalArtifactCandidate[] {
  return item.asset.refs
    .filter((ref) => kinds.includes(ref.kind))
    .map((ref) => {
      const artifact = getArtifactById(item, ref.artifactId);
      if (!artifact) return null;
      const metadata = mergeMetadata(item.asset.metadata, artifact.metadata, ref.metadata);
      const fileName = normalizeFileName(
        metadataString(metadata, 'fileName') ??
        metadataString(metadata, 'sourceFileName') ??
        metadataString(metadata, 'name') ??
        item.asset.source.fileName ??
        item.asset.name ??
        item.name,
      );
      return {
        ref,
        artifact,
        fileName: fileName ?? `${item.name || item.asset.name || artifact.artifactId}`,
        mimeType: ref.mimeType || artifact.mimeType || item.asset.source.mimeType || 'application/octet-stream',
      };
    })
    .filter((candidate): candidate is SignalArtifactCandidate => candidate !== null);
}

function modelExtensionFromMime(mimeType: string | undefined): string | undefined {
  const normalized = mimeType?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'model/gltf-binary' || normalized.includes('gltf-binary')) return 'glb';
  if (normalized === 'model/gltf+json' || normalized.includes('gltf+json')) return 'gltf';
  if (normalized === 'model/obj' || normalized.includes('wavefront') || normalized.includes('obj')) return 'obj';
  if (normalized === 'model/fbx' || normalized.includes('fbx')) return 'fbx';
  return undefined;
}

function splatExtensionFromMime(mimeType: string | undefined): string | undefined {
  const normalized = mimeType?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('ply')) return 'ply';
  if (normalized.includes('splat')) return 'splat';
  return undefined;
}

function getRenderableExtension(
  candidate: SignalArtifactCandidate,
  item: SignalAssetItem,
  mediaType: SignalFileMediaType,
): string | undefined {
  const metadata = mergeMetadata(item.asset.metadata, candidate.artifact.metadata, candidate.ref.metadata);
  const explicitFormat = normalizeExtension(metadataString(metadata, 'format'));
  const explicitExtension = normalizeExtension(metadataString(metadata, 'extension') ?? item.asset.source.extension);
  const nameExtension = fileExtension(candidate.fileName);
  const mimeExtension = mediaType === 'model'
    ? modelExtensionFromMime(candidate.mimeType)
    : splatExtensionFromMime(candidate.mimeType);

  const extensions = [nameExtension, explicitFormat, explicitExtension, mimeExtension].filter(
    (extension): extension is string => Boolean(extension),
  );

  return extensions.find((extension) => {
    const probe = `asset.${extension}`;
    return mediaType === 'model' ? isModelFile(probe) : isGaussianSplatFile(probe);
  });
}

function withExtension(fileName: string, extension: string): string {
  if (fileExtension(fileName) === extension) return fileName;
  if (fileExtension(fileName)) return `${withoutKnownExtension(fileName)}.${extension}`;
  return `${fileName}.${extension}`;
}

function createFilePlan(
  item: SignalAssetItem,
  candidate: SignalArtifactCandidate,
  mediaType: SignalFileMediaType,
  extension: string,
): SignalTimelineFileRenderPlan {
  const isModel = mediaType === 'model';
  return {
    kind: 'file',
    adapterId: isModel ? SIGNAL_MODEL_RENDERER_ADAPTER_ID : SIGNAL_GAUSSIAN_SPLAT_RENDERER_ADAPTER_ID,
    mediaTypeOverride: mediaType,
    clipName: item.name || item.asset.name || candidate.fileName || 'Signal',
    duration: isModel ? SIGNAL_MODEL_RENDERER_DEFAULT_DURATION : SIGNAL_GAUSSIAN_SPLAT_RENDERER_DEFAULT_DURATION,
    signalAssetId: item.id,
    signalRefId: candidate.ref.id,
    artifactId: candidate.artifact.artifactId,
    artifactHash: candidate.artifact.hash,
    fileName: withExtension(candidate.fileName, extension),
    mimeType: candidate.mimeType,
  };
}

function createModelRenderPlan(item: SignalAssetItem): SignalTimelineFileRenderPlan | null {
  for (const candidate of getRefArtifactCandidates(item, ['mesh', 'geometry', 'scene', 'binary'])) {
    const extension = getRenderableExtension(candidate, item, 'model');
    if (extension) {
      return createFilePlan(item, candidate, 'model', extension);
    }
  }
  return null;
}

function createGaussianSplatRenderPlan(item: SignalAssetItem): SignalTimelineFileRenderPlan | null {
  for (const candidate of getRefArtifactCandidates(item, ['point-cloud', 'geometry', 'scene', 'binary'])) {
    const extension = getRenderableExtension(candidate, item, 'gaussian-splat');
    if (extension) {
      return createFilePlan(item, candidate, 'gaussian-splat', extension);
    }
  }
  return null;
}

export function createSignalTimelineAdapterPlan(item: SignalAssetItem): SignalTimelineAdapterPlan {
  return (
    createModelRenderPlan(item) ??
    createGaussianSplatRenderPlan(item) ??
    { kind: 'text', ...createSignalTimelineRenderPlan(item) }
  );
}

async function getStoredSignalArtifact(artifact: SignalArtifact): Promise<Blob | null> {
  const projectHandle = projectFileService.getProjectHandle?.() ?? null;

  if (artifact.storage.kind === 'project-cache' && projectHandle) {
    const stored = await artifactService.getArtifact(projectHandle, artifact.artifactId);
    if (stored?.blob) return stored.blob;
  }

  if (artifact.storage.kind === 'indexeddb') {
    const stored = await artifactService.getIndexedDBArtifact(artifact.artifactId);
    if (stored?.blob) return stored.blob;
  }

  if (projectHandle) {
    const stored = await artifactService.getArtifact(projectHandle, artifact.artifactId);
    if (stored?.blob) return stored.blob;
  }

  const indexed = await artifactService.getIndexedDBArtifact(artifact.artifactId);
  return indexed?.blob ?? null;
}

export async function materializeSignalTimelineRenderFile(
  item: SignalAssetItem,
  plan: SignalTimelineAdapterPlan,
): Promise<File | null> {
  if (plan.kind !== 'file') return null;

  const artifact = getArtifactById(item, plan.artifactId);
  if (!artifact) return null;

  const storedBlob = await getStoredSignalArtifact(artifact);
  if (!storedBlob) return null;

  const blob = artifact.byteRange
    ? storedBlob.slice(
        artifact.byteRange.offset,
        artifact.byteRange.offset + artifact.byteRange.length,
        plan.mimeType || storedBlob.type || artifact.mimeType,
      )
    : storedBlob;

  return new File([blob], plan.fileName, {
    type: plan.mimeType || blob.type || artifact.mimeType || 'application/octet-stream',
    lastModified: Date.parse(artifact.createdAt) || Date.now(),
  });
}

function buildFileClipOptions(plan: SignalTimelineFileRenderPlan): AddClipOptions {
  const source: Partial<NonNullable<TimelineClip['source']>> = plan.mediaTypeOverride === 'model'
    ? {
        modelFileName: plan.fileName,
      }
    : {
        gaussianSplatFileName: plan.fileName,
        gaussianSplatFileHash: plan.artifactHash,
        gaussianSplatRuntimeKey: plan.artifactId,
      };

  return {
    name: plan.clipName,
    signalAssetId: plan.signalAssetId,
    signalRefId: plan.signalRefId,
    signalRenderAdapterId: plan.adapterId,
    source,
  };
}

async function placeTextFallback(
  item: SignalAssetItem,
  trackId: string,
  startTime: number,
  actions: SignalTimelinePlacementActions,
): Promise<SignalTimelinePlacementResult> {
  const plan: SignalTimelineAdapterPlan = { kind: 'text', ...createSignalTimelineRenderPlan(item) };
  const clipId = await actions.addTextClip(trackId, startTime, plan.duration, true);
  if (!clipId) {
    return { clipId: null, plan };
  }

  actions.updateTextProperties(clipId, plan.textProperties);
  actions.updateClip(clipId, {
    name: plan.clipName,
    signalAssetId: plan.signalAssetId,
    signalRefId: plan.signalRefId,
    signalRenderAdapterId: SIGNAL_TEXT_RENDERER_ADAPTER_ID,
  });

  return { clipId, plan };
}

export async function placeSignalAssetOnTimeline(
  item: SignalAssetItem,
  trackId: string,
  startTime: number,
  actions: SignalTimelinePlacementActions,
): Promise<SignalTimelinePlacementResult> {
  const plan = createSignalTimelineAdapterPlan(item);

  if (plan.kind === 'file') {
    try {
      const file = await materializeSignalTimelineRenderFile(item, plan);
      if (file) {
        const clipId = await actions.addClip(
          trackId,
          file,
          startTime,
          plan.duration,
          undefined,
          plan.mediaTypeOverride,
          buildFileClipOptions(plan),
        );
        return {
          clipId: typeof clipId === 'string' ? clipId : null,
          plan,
        };
      }
    } catch (error) {
      const fallback = await placeTextFallback(item, trackId, startTime, actions);
      return {
        ...fallback,
        fallbackReason: error instanceof Error ? error.message : String(error),
      };
    }

    const fallback = await placeTextFallback(item, trackId, startTime, actions);
    return {
      ...fallback,
      fallbackReason: `Artifact ${plan.artifactId} is not available as a Blob.`,
    };
  }

  return placeTextFallback(item, trackId, startTime, actions);
}
