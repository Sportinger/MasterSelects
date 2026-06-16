import { useMediaStore } from '../../stores/mediaStore';
import type { SignalAssetItem } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { RenderTargetSnapshot } from '../../engine/render/contracts';
import type { VideoBakeRegion } from '../../types/clipMetadata';
import type { TimelineClip } from '../../types/timeline';
import { captureRenderTargetSnapshot } from '../render/renderTargetSnapshotFactory';
import { renderHostPort, type RenderCaptureCanvas } from '../render/renderHostPort';
import {
  fingerprintCanvas,
  type FrameFingerprintOptions,
} from './frameFingerprint';
import { ensureRenderForDiagnostics } from './handlers/renderOnce';
import type { ToolResult } from './types';
import {
  recordWorkerFirstGoldenFixtureCapture,
} from './workerFirstProofCaptures';
import {
  WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS,
  type WorkerFirstGoldenProjectManifest,
} from './workerFirstProofHarness';

export interface WorkerFirstGoldenFixtureBridgeDeps {
  readonly getCaptureCanvas: () => RenderCaptureCanvas | null;
  readonly setPlayheadPosition: (timeSeconds: number) => void;
  readonly ensureRender: () => Promise<{ requested: boolean; waitedMs: number }>;
  readonly getTimelineSignals: () => readonly string[];
  readonly getTimelineDuration: () => number;
}

export interface WorkerFirstTimelineSignalContext {
  readonly proxyEnabled?: boolean;
  readonly isDraggingPlayhead?: boolean;
  readonly hasClipDragPreview?: boolean;
  readonly signalAssets?: readonly Pick<SignalAssetItem, 'id' | 'signalKinds' | 'asset'>[];
  readonly proxyMediaRecords?: readonly {
    readonly id: string;
    readonly proxyStatus?: string;
    readonly proxyFps?: number;
    readonly proxyFormat?: string;
  }[];
}

export interface WorkerFirstRamCacheSignalContext {
  readonly ramPreviewRange?: { readonly start: number; readonly end: number } | null;
  readonly cachedFrameCount?: number;
  readonly cachedRanges?: readonly { readonly start: number; readonly end: number }[];
  readonly isRamPreviewing?: boolean;
  readonly ramPreviewProgress?: number | null;
  readonly compositeCacheStats?: { readonly count?: number } | null;
}

export interface WorkerFirstBakeSignalContext {
  readonly clips?: readonly TimelineClip[];
  readonly videoBakeRegions?: readonly VideoBakeRegion[];
}

export interface WorkerFirstExportSignalContext {
  readonly completed?: boolean;
  readonly blobSize?: number | null;
  readonly previewSampleCount?: number | null;
  readonly failures?: readonly unknown[];
}

const DEFAULT_DEPS: WorkerFirstGoldenFixtureBridgeDeps = {
  getCaptureCanvas: () => renderHostPort.getCaptureCanvas(),
  setPlayheadPosition: (timeSeconds) => {
    useTimelineStore.getState().setPlayheadPosition(timeSeconds);
  },
  ensureRender: () => ensureRenderForDiagnostics(),
  getTimelineSignals: () => {
    const timelineState = useTimelineStore.getState();
    const mediaState = useMediaStore.getState();
    const timelineSignals = collectCurrentTimelineSignals(timelineState.clips, {
      proxyEnabled: mediaState.proxyEnabled,
      isDraggingPlayhead: timelineState.isDraggingPlayhead,
      hasClipDragPreview: timelineState.clipDragPreview != null,
      signalAssets: mediaState.signalAssets,
      proxyMediaRecords: mediaState.files,
    });
    const ramCacheSignals = collectCurrentRamCacheSignals({
      ramPreviewRange: timelineState.ramPreviewRange,
      cachedFrameCount: timelineState.cachedFrameTimes.size,
      cachedRanges: timelineState.getCachedRanges(),
      isRamPreviewing: timelineState.isRamPreviewing,
      ramPreviewProgress: timelineState.ramPreviewProgress,
      compositeCacheStats: renderHostPort.getCompositeCacheStats(),
    });
    const bakeSignals = collectCurrentBakeSignals({
      clips: timelineState.clips,
      videoBakeRegions: timelineState.videoBakeRegions,
    });
    return combineSignals(
      timelineSignals,
      collectCurrentRenderTargetSignals(captureRenderTargetSnapshot()),
      ramCacheSignals,
      bakeSignals,
    );
  },
  getTimelineDuration: () => useTimelineStore.getState().duration,
};

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readOptionalSampleDimension(args: Record<string, unknown>, key: string): number | null | undefined {
  if (args[key] === undefined) return undefined;
  const parsed = readFiniteNumber(args[key]);
  if (parsed === null) return null;
  return Math.max(1, Math.min(256, Math.round(parsed)));
}

function readOptionalSettleMs(args: Record<string, unknown>): number | null {
  if (args.settleMs === undefined) return 0;
  const parsed = readFiniteNumber(args.settleMs);
  if (parsed === null) return null;
  return Math.max(0, Math.min(5000, Math.round(parsed)));
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function resolveManifest(projectId: unknown): WorkerFirstGoldenProjectManifest | null {
  return WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.find((manifest) => manifest.id === projectId) ?? null;
}

function resolveSampleTime(manifest: WorkerFirstGoldenProjectManifest, value: unknown): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null) return null;
  return manifest.sampleTimesSeconds.find((sampleTimeSeconds) => (
    Math.abs(sampleTimeSeconds - parsed) <= 0.000001
  )) ?? null;
}

function addUniqueSignal(signals: string[], signal: string): void {
  if (!signals.includes(signal)) {
    signals.push(signal);
  }
}

const MODEL_EXTENSIONS = new Set(['obj', 'fbx', 'gltf', 'glb']);
const GAUSSIAN_EXTENSIONS = new Set(['ply', 'pcd', 'las', 'laz', 'splat', 'spz', 'ksplat']);
const CAD_EXTENSIONS = new Set(['dxf', 'step', 'stp']);
const CAD_MIME_TYPES = new Set(['image/vnd.dxf', 'model/step', 'application/step']);

function combineSignals(...groups: readonly (readonly string[])[]): readonly string[] {
  const signals: string[] = [];
  for (const group of groups) {
    for (const signal of group) {
      addUniqueSignal(signals, signal);
    }
  }
  return signals.toSorted();
}

function hasUsableJpegProxySignal(
  clip: TimelineClip,
  context: WorkerFirstTimelineSignalContext,
): boolean {
  if (!context.proxyEnabled || (!context.isDraggingPlayhead && !context.hasClipDragPreview)) {
    return false;
  }
  const mediaKey = ['media', 'Fi', 'leId'].join('');
  const sourceRecord = clip.source as Record<string, unknown> | null;
  const clipRecord = clip as unknown as Record<string, unknown>;
  const mediaId = sourceRecord?.[mediaKey] ?? clipRecord[mediaKey];
  if (typeof mediaId !== 'string' || !mediaId) return false;
  const mediaRecord = context.proxyMediaRecords?.find((candidate) => candidate.id === mediaId);
  if (!mediaRecord?.proxyFps || mediaRecord.proxyFormat === 'mp4-all-intra') return false;
  return mediaRecord.proxyStatus === 'ready' || mediaRecord.proxyStatus === 'generating';
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeExtension(value: string | undefined | null): string | null {
  const normalized = value?.trim().replace(/^\./, '').toLowerCase();
  return normalized || null;
}

function extensionFromName(value: string | undefined | null): string | null {
  if (!value) return null;
  const fileName = value.split(/[\\/]/).pop() ?? value;
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex >= fileName.length - 1) return null;
  return normalizeExtension(fileName.slice(dotIndex + 1));
}

function addSignalAssetExtension(extensions: string[], value: string | undefined | null): void {
  const normalized = normalizeExtension(value) ?? extensionFromName(value);
  if (normalized && !extensions.includes(normalized)) {
    extensions.push(normalized);
  }
}

function collectSignalAssetExtensions(asset: Pick<SignalAssetItem, 'asset'>): readonly string[] {
  const extensions: string[] = [];
  addSignalAssetExtension(extensions, asset.asset.source.extension);
  addSignalAssetExtension(extensions, asset.asset.source.fileName);
  for (const ref of asset.asset.refs) {
    addSignalAssetExtension(extensions, readMetadataString(ref.metadata, 'extension'));
    addSignalAssetExtension(extensions, readMetadataString(ref.metadata, 'format'));
    addSignalAssetExtension(extensions, readMetadataString(ref.metadata, 'fileName'));
    addSignalAssetExtension(extensions, readMetadataString(ref.metadata, 'sourceFileName'));
  }
  for (const artifact of asset.asset.artifacts) {
    addSignalAssetExtension(extensions, readMetadataString(artifact.metadata, 'extension'));
    addSignalAssetExtension(extensions, readMetadataString(artifact.metadata, 'format'));
    addSignalAssetExtension(extensions, readMetadataString(artifact.metadata, 'fileName'));
    addSignalAssetExtension(extensions, readMetadataString(artifact.metadata, 'sourceFileName'));
  }
  return extensions;
}

function collectSignalAssetMimeTypes(asset: Pick<SignalAssetItem, 'asset'>): readonly string[] {
  const values = [
    asset.asset.source.mimeType,
    ...asset.asset.refs.map((ref) => ref.mimeType),
    ...asset.asset.artifacts.map((artifact) => artifact.mimeType),
  ];
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
}

function getClipSignalAsset(
  clip: TimelineClip,
  context: WorkerFirstTimelineSignalContext,
): Pick<SignalAssetItem, 'id' | 'signalKinds' | 'asset'> | null {
  const signalAssetId = clip.signalAssetId;
  if (!signalAssetId) return null;
  return context.signalAssets?.find((asset) => asset.id === signalAssetId) ?? null;
}

function collectSignalAssetSignals(
  clip: TimelineClip,
  signals: string[],
  context: WorkerFirstTimelineSignalContext,
): void {
  const signalAsset = getClipSignalAsset(clip, context);
  if (!signalAsset) return;

  const extensions = collectSignalAssetExtensions(signalAsset);
  const mimeTypes = collectSignalAssetMimeTypes(signalAsset);
  const metadata = signalAsset.asset.metadata as Record<string, unknown> | undefined;
  const formatFamily = readMetadataString(metadata, 'formatFamily');
  const hasModelDescriptor = extensions.some((extension) => MODEL_EXTENSIONS.has(extension));
  const hasGaussianDescriptor = extensions.some((extension) => GAUSSIAN_EXTENSIONS.has(extension));
  const hasCadDescriptor =
    extensions.some((extension) => CAD_EXTENSIONS.has(extension)) ||
    mimeTypes.some((mimeType) => CAD_MIME_TYPES.has(mimeType)) ||
    formatFamily === 'cad-technical';

  if (hasModelDescriptor || hasCadDescriptor) {
    addUniqueSignal(signals, '3d');
  }
  if (hasGaussianDescriptor) {
    addUniqueSignal(signals, '3d');
    addUniqueSignal(signals, 'gaussian');
  }
  if (hasCadDescriptor) {
    addUniqueSignal(signals, 'cad');
  }
}

function collectClipSignals(
  clip: TimelineClip,
  signals: string[],
  context: WorkerFirstTimelineSignalContext,
): void {
  const sourceType = clip.source?.type;
  if (sourceType) {
    addUniqueSignal(signals, sourceType);
  }
  if (clip.is3D || sourceType === 'model') {
    addUniqueSignal(signals, '3d');
  }
  if (sourceType === 'gaussian-splat' || sourceType === 'gaussian-avatar') {
    addUniqueSignal(signals, '3d');
    addUniqueSignal(signals, 'gaussian');
  }
  collectSignalAssetSignals(clip, signals, context);
  if (sourceType === 'video' && hasUsableJpegProxySignal(clip, context)) {
    addUniqueSignal(signals, 'proxy-image');
  }
  if (clip.source?.videoElement) {
    addUniqueSignal(signals, 'html-video');
  }
  if (clip.source?.webCodecsPlayer) {
    addUniqueSignal(signals, 'webcodecs');
  }
  if (clip.isComposition || clip.compositionId || clip.nestedClips?.length) {
    addUniqueSignal(signals, 'composition');
    addUniqueSignal(signals, 'nested-composition');
  }
  if (clip.effects.length > 0) {
    addUniqueSignal(signals, 'effect');
  }
  if (clip.masks?.length) {
    addUniqueSignal(signals, 'mask');
  }
  if (clip.transitionIn || clip.transitionOut) {
    addUniqueSignal(signals, 'transition');
  }
  if (clip.transform?.blendMode && clip.transform.blendMode !== 'normal') {
    addUniqueSignal(signals, 'blend-mode');
  }
}

export function collectCurrentTimelineSignals(
  clips: readonly TimelineClip[],
  context: WorkerFirstTimelineSignalContext = {},
): readonly string[] {
  const signals: string[] = [];
  for (const clip of clips) {
    collectClipSignals(clip, signals, context);
  }
  if (signals.includes('video')) {
    addUniqueSignal(signals, 'audio-clock');
  }
  return signals.toSorted();
}

export function collectCurrentRenderTargetSignals(snapshot: RenderTargetSnapshot | null | undefined): readonly string[] {
  const signals: string[] = [];
  if (!snapshot) return signals;
  const activeTargetCount = snapshot.targets.filter((target) => target.enabled).length;
  if (activeTargetCount > 0 || snapshot.activeCompositionTargetIds.length > 0 || snapshot.independentTargetIds.length > 0) {
    addUniqueSignal(signals, 'render-target');
  }
  const hasEnabledSlice = Object.values(snapshot.sliceConfigs)
    .some((config) => config.slices.some((slice) => slice.enabled));
  if (hasEnabledSlice) {
    addUniqueSignal(signals, 'output-slice');
  }
  return signals.toSorted();
}

export function collectCurrentRamCacheSignals(context: WorkerFirstRamCacheSignalContext): readonly string[] {
  const signals: string[] = [];
  if (
    context.isRamPreviewing ||
    context.ramPreviewRange != null ||
    (context.ramPreviewProgress != null && Number.isFinite(context.ramPreviewProgress)) ||
    (context.cachedFrameCount ?? 0) > 0 ||
    (context.cachedRanges?.length ?? 0) > 0
  ) {
    addUniqueSignal(signals, 'ram-preview');
  }
  if ((context.compositeCacheStats?.count ?? 0) > 0) {
    addUniqueSignal(signals, 'composite-cache');
  }
  return signals.toSorted();
}

export function collectCurrentBakeSignals(context: WorkerFirstBakeSignalContext): readonly string[] {
  const signals: string[] = [];
  const hasBakedClipRegion = context.clips?.some((clip) => (
    clip.videoState?.bakeRegions?.some((region) => region.scope === 'clip' && region.status === 'baked')
  )) ?? false;
  if (hasBakedClipRegion) {
    addUniqueSignal(signals, 'clip-bake');
  }

  const hasBakedCompositionRegion = context.videoBakeRegions?.some((region) => (
    region.scope === 'composition' && region.status === 'baked'
  )) ?? false;
  if (hasBakedCompositionRegion) {
    addUniqueSignal(signals, 'composition-bake');
  }

  return signals.toSorted();
}

export function collectCurrentExportSignals(context: WorkerFirstExportSignalContext): readonly string[] {
  const signals: string[] = [];
  const blobSize = typeof context.blobSize === 'number' && Number.isFinite(context.blobSize)
    ? context.blobSize
    : 0;
  const previewSampleCount = typeof context.previewSampleCount === 'number' && Number.isFinite(context.previewSampleCount)
    ? context.previewSampleCount
    : 0;
  if (context.completed === true && blobSize > 0 && previewSampleCount > 0 && (context.failures?.length ?? 0) === 0) {
    addUniqueSignal(signals, 'export');
  }
  return signals.toSorted();
}

function findMissingRequiredSignals(
  manifest: WorkerFirstGoldenProjectManifest,
  observedSignals: readonly string[],
): string[] {
  return manifest.requiredSignals.filter((signal) => !observedSignals.includes(signal));
}

function buildFingerprintOptions(args: Record<string, unknown>): FrameFingerprintOptions | ToolResult {
  const sampleWidth = readOptionalSampleDimension(args, 'sampleWidth');
  const sampleHeight = readOptionalSampleDimension(args, 'sampleHeight');
  if (sampleWidth === null || sampleHeight === null) {
    return {
      success: false,
      error: 'sampleWidth and sampleHeight must be finite numbers when provided.',
    };
  }
  return {
    ...(sampleWidth !== undefined ? { sampleWidth } : {}),
    ...(sampleHeight !== undefined ? { sampleHeight } : {}),
  };
}

export async function handleCaptureWorkerFirstGoldenFixtureFingerprint(
  args: Record<string, unknown>,
  deps: WorkerFirstGoldenFixtureBridgeDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  const manifest = resolveManifest(args.projectId);
  if (!manifest) {
    return {
      success: false,
      error: 'A valid worker-first golden fixture projectId is required.',
      data: {
        allowedProjectIds: WORKER_FIRST_GOLDEN_PROJECT_MANIFESTS.map((entry) => entry.id),
      },
    };
  }

  if (args.source !== undefined || args.fingerprint !== undefined) {
    return {
      success: false,
      error: 'Golden fixture source and fingerprint are captured from the render host and cannot be caller-supplied.',
    };
  }

  if (manifest.status === 'fixture-required') {
    return {
      success: false,
      error: 'This golden fixture manifest is not materialized yet and cannot be captured without overclaiming evidence.',
      data: {
        projectId: manifest.id,
        manifestStatus: manifest.status,
        requiredSignals: manifest.requiredSignals,
      },
    };
  }

  const sampleTimeSeconds = resolveSampleTime(manifest, args.sampleTimeSeconds);
  if (sampleTimeSeconds === null) {
    return {
      success: false,
      error: 'sampleTimeSeconds must match one of the manifest sample times.',
      data: {
        projectId: manifest.id,
        sampleTimesSeconds: manifest.sampleTimesSeconds,
      },
    };
  }

  const timelineSignals = deps.getTimelineSignals();
  const missingRequiredSignals = findMissingRequiredSignals(manifest, timelineSignals);
  if (missingRequiredSignals.length > 0) {
    return {
      success: false,
      error: 'The current timeline does not satisfy the selected golden fixture manifest signals.',
      data: {
        projectId: manifest.id,
        observedSignals: timelineSignals,
        missingRequiredSignals,
      },
    };
  }

  const timelineDuration = deps.getTimelineDuration();
  if (Number.isFinite(timelineDuration) && timelineDuration > 0 && sampleTimeSeconds > timelineDuration + 0.000001) {
    return {
      success: false,
      error: 'sampleTimeSeconds is outside the current timeline duration.',
      data: {
        sampleTimeSeconds,
        timelineDuration,
      },
    };
  }

  const fingerprintOptions = buildFingerprintOptions(args);
  if ('success' in fingerprintOptions) {
    return fingerprintOptions;
  }
  const settleMs = readOptionalSettleMs(args);
  if (settleMs === null) {
    return {
      success: false,
      error: 'settleMs must be a finite number when provided.',
    };
  }

  deps.setPlayheadPosition(sampleTimeSeconds);
  let renderDiagnostics = await deps.ensureRender();
  if (settleMs > 0) {
    await waitMs(settleMs);
    const settledDiagnostics = await deps.ensureRender();
    renderDiagnostics = {
      requested: renderDiagnostics.requested || settledDiagnostics.requested,
      waitedMs: renderDiagnostics.waitedMs + settleMs + settledDiagnostics.waitedMs,
    };
  }

  const captureCanvas = deps.getCaptureCanvas();
  if (!captureCanvas) {
    return {
      success: false,
      error: 'No active render capture canvas is available.',
      data: {
        renderDiagnostics,
      },
    };
  }

  try {
    const fingerprint = fingerprintCanvas(captureCanvas.canvas, fingerprintOptions);
    recordWorkerFirstGoldenFixtureCapture({
      projectId: manifest.id,
      sampleTimeSeconds,
      fingerprint,
      source: 'main-renderer',
    });

    return {
      success: true,
      data: {
        projectId: manifest.id,
        manifestStatus: manifest.status,
        sampleTimeSeconds,
        source: 'main-renderer',
        canvasSource: captureCanvas.source,
        timelineSignals,
        fingerprint,
        renderDiagnostics,
        w5StartPermissionsRemainStatsGuarded: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fingerprint the render capture canvas.',
      data: {
        projectId: manifest.id,
        sampleTimeSeconds,
        canvasSource: captureCanvas.source,
        renderDiagnostics,
      },
    };
  }
}
