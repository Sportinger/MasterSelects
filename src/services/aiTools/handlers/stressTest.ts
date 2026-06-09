import { engine } from '../../../engine/WebGPUEngine';
import type { AnimatableProperty, ClipMask, MaskVertex, TimelineClip } from '../../../types';
import { useMediaStore, type Composition, type MediaFile } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { compositionRenderer } from '../../compositionRenderer';
import { Logger } from '../../logger';
import type { CallerContext } from '../policy';
import type { ToolResult } from '../types';
import { handleImportLocalFiles } from './media';

const log = Logger.create('AITool:StressTest');

type FixtureRole = 'primary-motion' | 'blend-mask' | 'detail-nested';

interface ImportedMediaResult {
  id: string;
  name: string;
  type: string;
  duration?: number;
  path: string;
}

interface ImportLocalFilesData {
  imported?: ImportedMediaResult[];
  errors?: Array<{ path: string; error: string }>;
}

interface FixtureClipSummary {
  id: string;
  name: string;
  startTime: number;
  duration: number;
  trackId: string;
  sourceType: string | undefined;
  isComposition: boolean;
  effectCount: number;
  maskCount: number;
  keyframeCount: number;
  hasTransitionIn: boolean;
  hasTransitionOut: boolean;
}

interface FixtureCompositionSummary {
  id: string;
  name: string;
  duration: number;
  trackCount: number;
  clipCount: number;
  effectCount: number;
  maskCount: number;
  keyframeCount: number;
  compositionClipCount: number;
}

interface FixtureBuildContext {
  primary: MediaFile;
  blend: MediaFile;
  detail: MediaFile;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
}

function normalizePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.replace(/\\/g, '/'));
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForAnimationFrame(): Promise<void> {
  await new Promise<number>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(resolve);
      return;
    }
    window.setTimeout(() => resolve(performance.now()), 16);
  });
}

async function waitForCompositionReady(compositionId: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    const mediaState = useMediaStore.getState();
    const timelineState = useTimelineStore.getState();
    const composition = mediaState.compositions.find((entry) => entry.id === compositionId);
    const timelineDataTracks = composition?.timelineData?.tracks ?? [];
    const active = mediaState.activeCompositionId === compositionId;
    const tracksReady = timelineDataTracks.length === 0 || (
      timelineState.tracks.length === timelineDataTracks.length &&
      timelineDataTracks.every((track, index) => timelineState.tracks[index]?.id === track.id)
    );

    if (active && tracksReady) {
      return true;
    }

    await waitForTimeout(25);
  }

  return false;
}

async function openComposition(compositionId: string): Promise<void> {
  const mediaStore = useMediaStore.getState();
  mediaStore.openCompositionTab(compositionId, { skipAnimation: true });
  const ready = await waitForCompositionReady(compositionId);
  if (!ready) {
    log.warn('Timed out waiting for fixture composition switch', { compositionId });
  }
}

function saveActiveTimelineToComposition(compositionId: string, durationSeconds: number): void {
  const timelineStore = useTimelineStore.getState();
  const mediaStore = useMediaStore.getState();
  const timelineData = {
    ...timelineStore.getSerializableState(),
    duration: durationSeconds,
    durationLocked: true,
  };

  mediaStore.updateComposition(compositionId, {
    duration: durationSeconds,
    timelineData,
  });
  compositionRenderer.invalidateCompositionAndParents(compositionId);
}

function getVideoTracks(): { top: string; middle: string; base: string } {
  const timelineStore = useTimelineStore.getState();
  const videoTracks = timelineStore.tracks.filter((track) => track.type === 'video');
  if (videoTracks.length < 2) {
    timelineStore.addTrack('video');
  }
  const refreshedVideoTracks = useTimelineStore.getState().tracks.filter((track) => track.type === 'video');
  const top = refreshedVideoTracks[0];
  const middle = refreshedVideoTracks[1] ?? top;
  const base = refreshedVideoTracks[refreshedVideoTracks.length - 1] ?? top;

  if (!top || !base) {
    throw new Error('Fixture timeline has no video tracks');
  }

  return {
    top: top.id,
    middle: middle.id,
    base: base.id,
  };
}

async function addMediaSegment(params: {
  media: MediaFile;
  trackId: string;
  startTime: number;
  inPoint: number;
  outPoint: number;
  name: string;
}): Promise<TimelineClip> {
  const { media, trackId, startTime, inPoint, outPoint, name } = params;
  const file = media.file;
  if (!file) {
    throw new Error(`Media file is not loaded: ${media.name}`);
  }

  const timelineStore = useTimelineStore.getState();
  const beforeIds = new Set(timelineStore.clips.map((clip) => clip.id));
  const duration = Math.max(0.05, outPoint - inPoint);
  await timelineStore.addClip(trackId, file, startTime, duration, media.id);

  const createdClips = useTimelineStore.getState().clips.filter((clip) => !beforeIds.has(clip.id));
  const trimmedClipIds = new Set<string>();
  for (const clip of createdClips) {
    if (trimmedClipIds.has(clip.id)) continue;
    const trimResult = useTimelineStore.getState().applyTimelineEditOperation({
      id: `stressTest-segment-trim:${clip.id}:${inPoint}:${outPoint}`,
      type: 'trim-clip',
      clipId: clip.id,
      inPoint,
      outPoint,
      includeLinked: true,
    }, {
      source: 'ai-tool',
      historyLabel: 'Stress test fixture: trim media segment',
    });
    if (!trimResult.success) {
      throw new Error(trimResult.warnings.map((warning) => warning.message).join(' ') || `Failed to trim fixture segment for ${media.name}`);
    }
    trimmedClipIds.add(clip.id);
    if (clip.linkedClipId) trimmedClipIds.add(clip.linkedClipId);
  }

  const visualClip = useTimelineStore.getState().clips.find((clip) =>
    !beforeIds.has(clip.id) &&
    clip.trackId === trackId &&
    clip.source?.type !== 'audio'
  );
  if (!visualClip) {
    throw new Error(`Failed to add fixture segment for ${media.name}`);
  }

  useTimelineStore.getState().updateClip(visualClip.id, { name });
  const refreshedClip = useTimelineStore.getState().clips.find((clip) => clip.id === visualClip.id);
  if (!refreshedClip) {
    throw new Error(`Fixture segment disappeared after creation: ${visualClip.id}`);
  }
  return refreshedClip;
}

async function addCompositionSegment(params: {
  composition: Composition;
  trackId: string;
  startTime: number;
  name: string;
}): Promise<TimelineClip> {
  const { composition, trackId, startTime, name } = params;
  const timelineStore = useTimelineStore.getState();
  const beforeIds = new Set(timelineStore.clips.map((clip) => clip.id));
  await timelineStore.addCompClip(trackId, composition, startTime);
  const createdClip = useTimelineStore.getState().clips.find((clip) =>
    !beforeIds.has(clip.id) &&
    clip.trackId === trackId &&
    clip.isComposition === true
  );
  if (!createdClip) {
    throw new Error(`Failed to add nested composition clip for ${composition.name}`);
  }
  useTimelineStore.getState().updateClip(createdClip.id, { name });
  const refreshedClip = useTimelineStore.getState().clips.find((clip) => clip.id === createdClip.id);
  if (!refreshedClip) {
    throw new Error(`Nested composition clip disappeared after creation: ${createdClip.id}`);
  }
  return refreshedClip;
}

function updateClipVisuals(clipId: string, updates: Partial<TimelineClip>): void {
  useTimelineStore.getState().updateClip(clipId, updates);
  useTimelineStore.getState().invalidateCache();
}

function addEffect(clipId: string, type: string, params: Record<string, string | number | boolean>): string {
  const timelineStore = useTimelineStore.getState();
  const effectId = timelineStore.addClipEffect(clipId, type);
  timelineStore.updateClipEffect(clipId, effectId, params);
  return effectId;
}

function addNumericKeyframes(
  clipId: string,
  property: AnimatableProperty,
  values: Array<{ time: number; value: number; easing?: string }>
): void {
  const timelineStore = useTimelineStore.getState();
  for (const entry of values) {
    timelineStore.addKeyframe(clipId, property, entry.value, entry.time, entry.easing ?? 'ease-in-out');
  }
}

function createMaskVertex(x: number, y: number, suffix: string): MaskVertex {
  return {
    id: `fixture-vertex-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

function addPolygonMask(
  clipId: string,
  name: string,
  points: Array<{ x: number; y: number }>,
  options?: Partial<Pick<ClipMask, 'feather' | 'featherQuality' | 'opacity' | 'mode' | 'position' | 'inverted'>>
): string {
  const vertices = points.map((point, index) => createMaskVertex(point.x, point.y, `${index}`));
  const maskId = useTimelineStore.getState().addMask(clipId, {
    name,
    vertices,
    closed: true,
    visible: true,
    enabled: true,
    feather: options?.feather ?? 18,
    featherQuality: options?.featherQuality ?? 70,
    opacity: options?.opacity ?? 1,
    mode: options?.mode ?? 'add',
    position: options?.position ?? { x: 0, y: 0 },
    inverted: options?.inverted ?? false,
  });
  useTimelineStore.getState().invalidateCache();
  return maskId;
}

function summarizeClips(clips: TimelineClip[]): FixtureClipSummary[] {
  const keyframes = useTimelineStore.getState().clipKeyframes;
  return clips.map((clip) => ({
    id: clip.id,
    name: clip.name,
    startTime: Math.round(clip.startTime * 1000) / 1000,
    duration: Math.round(clip.duration * 1000) / 1000,
    trackId: clip.trackId,
    sourceType: clip.source?.type,
    isComposition: clip.isComposition === true,
    effectCount: clip.effects?.length ?? 0,
    maskCount: clip.masks?.length ?? 0,
    keyframeCount: keyframes.get(clip.id)?.length ?? 0,
    hasTransitionIn: Boolean(clip.transitionIn),
    hasTransitionOut: Boolean(clip.transitionOut),
  }));
}

function summarizeActiveComposition(composition: Composition): FixtureCompositionSummary {
  const timelineStore = useTimelineStore.getState();
  const clips = timelineStore.clips;
  const keyframeCount = Array.from(timelineStore.clipKeyframes.values())
    .reduce((count, entries) => count + entries.length, 0);

  return {
    id: composition.id,
    name: composition.name,
    duration: composition.duration,
    trackCount: timelineStore.tracks.length,
    clipCount: clips.length,
    effectCount: clips.reduce((count, clip) => count + (clip.effects?.length ?? 0), 0),
    maskCount: clips.reduce((count, clip) => count + (clip.masks?.length ?? 0), 0),
    keyframeCount,
    compositionClipCount: clips.filter((clip) => clip.isComposition).length,
  };
}

function summarizeStoredComposition(composition: Composition): FixtureCompositionSummary {
  const timelineData = composition.timelineData;
  const clips = timelineData?.clips ?? [];
  const keyframeCount = clips.reduce((count, clip) => count + (clip.keyframes?.length ?? 0), 0);

  return {
    id: composition.id,
    name: composition.name,
    duration: composition.duration,
    trackCount: timelineData?.tracks.length ?? 0,
    clipCount: clips.length,
    effectCount: clips.reduce((count, clip) => count + (clip.effects?.length ?? 0), 0),
    maskCount: clips.reduce((count, clip) => count + (clip.masks?.length ?? 0), 0),
    keyframeCount,
    compositionClipCount: clips.filter((clip) => clip.isComposition).length,
  };
}

async function prepareImportedMedia(
  args: Record<string, unknown>,
  callerContext: CallerContext
): Promise<{ roles: Record<FixtureRole, MediaFile>; imported: ImportedMediaResult[]; errors?: Array<{ path: string; error: string }> }> {
  const mediaStore = useMediaStore.getState();
  const paths = normalizePaths(args.paths);
  const mediaFileIds = normalizeIds(args.mediaFileIds);
  let imported: ImportedMediaResult[] = [];
  let importErrors: Array<{ path: string; error: string }> | undefined;

  if (paths.length > 0) {
    const result = await handleImportLocalFiles({ paths, addToTimeline: false }, mediaStore, callerContext);
    if (!result.success) {
      return {
        roles: {} as Record<FixtureRole, MediaFile>,
        imported,
        errors: (result.data as ImportLocalFilesData | undefined)?.errors ?? [{ path: paths.join(', '), error: result.error ?? 'Import failed' }],
      };
    }
    const data = result.data as ImportLocalFilesData | undefined;
    imported = data?.imported ?? [];
    importErrors = data?.errors;
  }

  const roleIds = paths.length > 0
    ? imported.map((entry) => entry.id)
    : mediaFileIds;

  if (roleIds.length < 3) {
    throw new Error(`Stress test fixture needs at least 3 video files, got ${roleIds.length}`);
  }

  const freshMedia = useMediaStore.getState();
  const mediaById = new Map(freshMedia.files.map((file) => [file.id, file]));
  const primary = mediaById.get(roleIds[0]);
  const blend = mediaById.get(roleIds[1]);
  const detail = mediaById.get(roleIds[2]);
  if (!primary || !blend || !detail) {
    throw new Error('Imported stress test fixture media could not be resolved from media store');
  }

  return {
    roles: {
      'primary-motion': primary,
      'blend-mask': blend,
      'detail-nested': detail,
    },
    imported,
    errors: importErrors,
  };
}

async function buildSubComposition(ctx: FixtureBuildContext): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  const comp = mediaStore.createComposition('Stress test 02 - Detail Subcomp', {
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(comp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const detailClip = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.6,
    outPoint: Math.min(6.6, ctx.detail.duration ?? 6.6),
    name: 'sub detail base',
  });
  addEffect(detailClip.id, 'gaussian-blur', { radius: 3, samples: 9 });
  addEffect(detailClip.id, 'contrast', { amount: 1.28 });

  const blendClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.top,
    startTime: 0.65,
    inPoint: 1.0,
    outPoint: Math.min(6.2, ctx.blend.duration ?? 6.2),
    name: 'sub blend masked overlay',
  });
  updateClipVisuals(blendClip.id, {
    transform: {
      ...blendClip.transform,
      opacity: 0.72,
      blendMode: 'screen',
      position: { x: 0.16, y: -0.08, z: 0 },
      scale: { x: 0.7, y: 0.7 },
    },
  });
  addPolygonMask(blendClip.id, 'sub diamond mask', [
    { x: 0.5, y: 0.06 },
    { x: 0.9, y: 0.46 },
    { x: 0.54, y: 0.94 },
    { x: 0.12, y: 0.52 },
  ], { feather: 24, featherQuality: 75 });
  addNumericKeyframes(blendClip.id, 'position.x', [
    { time: 0, value: 0.08 },
    { time: 2.3, value: 0.2 },
    { time: 5.2, value: -0.04 },
  ]);

  timelineStore.setPlayheadPosition(0.25);
  saveActiveTimelineToComposition(comp.id, ctx.durationSeconds);
  return useMediaStore.getState().compositions.find((entry) => entry.id === comp.id) ?? comp;
}

async function buildNestedComposition(ctx: FixtureBuildContext, subComp: Composition): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  const comp = mediaStore.createComposition('Stress test 01 - Nested Blend', {
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(comp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const baseClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.2,
    outPoint: Math.min(6.2, ctx.blend.duration ?? 6.2),
    name: 'nested blend base',
  });
  addEffect(baseClip.id, 'saturation', { amount: 1.35 });
  addEffect(baseClip.id, 'brightness', { amount: -0.04 });

  const subClip = await addCompositionSegment({
    composition: subComp,
    trackId: tracks.middle,
    startTime: 0.35,
    name: 'nested detail subcomp layer',
  });
  updateClipVisuals(subClip.id, {
    transform: {
      ...subClip.transform,
      opacity: 0.82,
      blendMode: 'overlay',
      position: { x: -0.14, y: 0.08, z: 0 },
      scale: { x: 0.78, y: 0.78 },
    },
  });
  const subMaskId = useTimelineStore.getState().addEllipseMask(subClip.id);
  useTimelineStore.getState().updateMask(subClip.id, subMaskId, {
    name: 'nested soft ellipse',
    feather: 28,
    featherQuality: 80,
    opacity: 0.95,
    position: { x: 0.05, y: -0.02 },
  });

  const detailClip = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.top,
    startTime: 1.1,
    inPoint: 1.5,
    outPoint: Math.min(5.8, ctx.detail.duration ?? 5.8),
    name: 'nested masked detail strip',
  });
  updateClipVisuals(detailClip.id, {
    transform: {
      ...detailClip.transform,
      opacity: 0.58,
      blendMode: 'add',
      position: { x: 0.22, y: 0.18, z: 0 },
      scale: { x: 0.52, y: 0.52 },
    },
  });
  addPolygonMask(detailClip.id, 'nested angled strip mask', [
    { x: 0.05, y: 0.2 },
    { x: 0.88, y: 0.05 },
    { x: 0.96, y: 0.38 },
    { x: 0.18, y: 0.58 },
  ], { feather: 16, featherQuality: 65 });

  timelineStore.setPlayheadPosition(0.5);
  saveActiveTimelineToComposition(comp.id, ctx.durationSeconds);
  return useMediaStore.getState().compositions.find((entry) => entry.id === comp.id) ?? comp;
}

async function buildMainComposition(ctx: FixtureBuildContext, mainComp: Composition, nestedComp: Composition): Promise<Composition> {
  const mediaStore = useMediaStore.getState();
  mediaStore.updateComposition(mainComp.id, {
    name: 'Stress test 00 - Main Fast',
    width: ctx.width,
    height: ctx.height,
    frameRate: ctx.frameRate,
    duration: ctx.durationSeconds,
  });
  await openComposition(mainComp.id);

  const timelineStore = useTimelineStore.getState();
  timelineStore.addTrack('video');
  const tracks = getVideoTracks();

  const baseA = await addMediaSegment({
    media: ctx.primary,
    trackId: tracks.base,
    startTime: 0,
    inPoint: 0.1,
    outPoint: Math.min(3.4, ctx.primary.duration ?? 3.4),
    name: 'main voxel primary A',
  });
  const voxelEffectA = addEffect(baseA.id, 'voxel-relief', {
    columns: 92,
    height: 0.62,
    baseHeight: 0.012,
    gap: 0.055,
    tilt: 86,
    yaw: 0,
    perspective: 0.46,
    heightContrast: 1.2,
    ambient: 0.54,
    lightStrength: 0.62,
    colorMix: 0.94,
    temporalBlend: 0.08,
    lightAngle: 315,
    lightElevation: 48,
    floorBrightness: 0.08,
    edgeDarkness: 0.72,
    maxSteps: 64,
    reset: false,
  });
  addNumericKeyframes(baseA.id, `effect.${voxelEffectA}.height`, [
    { time: 0, value: 0.36 },
    { time: 1.6, value: 0.78 },
    { time: 3.3, value: 0.52 },
  ]);

  const baseB = await addMediaSegment({
    media: ctx.detail,
    trackId: tracks.base,
    startTime: 3.4,
    inPoint: 2.1,
    outPoint: Math.min(5.8, ctx.detail.duration ?? 5.8),
    name: 'main voxel detail B',
  });
  addEffect(baseB.id, 'voxel-relief', {
    columns: 84,
    height: 0.5,
    baseHeight: 0.02,
    gap: 0.06,
    tilt: 85,
    yaw: -4,
    perspective: 0.38,
    heightContrast: 1.34,
    ambient: 0.5,
    lightStrength: 0.64,
    colorMix: 0.92,
    temporalBlend: 0.06,
    lightAngle: 300,
    lightElevation: 44,
    floorBrightness: 0.09,
    edgeDarkness: 0.7,
    maxSteps: 60,
    reset: false,
  });
  timelineStore.applyTransition(baseA.id, baseB.id, 'crossfade', 0.42);

  const nestedClip = await addCompositionSegment({
    composition: nestedComp,
    trackId: tracks.middle,
    startTime: 0.55,
    name: 'main nested comp overlay',
  });
  updateClipVisuals(nestedClip.id, {
    transform: {
      ...nestedClip.transform,
      opacity: 0.72,
      blendMode: 'soft-light',
      position: { x: -0.2, y: 0.02, z: 0 },
      scale: { x: 0.58, y: 0.58 },
    },
  });
  const nestedMaskId = useTimelineStore.getState().addEllipseMask(nestedClip.id);
  useTimelineStore.getState().updateMask(nestedClip.id, nestedMaskId, {
    name: 'main nested vignette ellipse',
    feather: 34,
    featherQuality: 82,
    opacity: 0.9,
    position: { x: -0.02, y: 0.02 },
  });

  const topClip = await addMediaSegment({
    media: ctx.blend,
    trackId: tracks.top,
    startTime: 1.35,
    inPoint: 2.2,
    outPoint: Math.min(5.6, ctx.blend.duration ?? 5.6),
    name: 'main additive mask color layer',
  });
  updateClipVisuals(topClip.id, {
    transform: {
      ...topClip.transform,
      opacity: 0.48,
      blendMode: 'screen',
      position: { x: 0.18, y: -0.14, z: 0 },
      scale: { x: 0.46, y: 0.46 },
    },
  });
  addEffect(topClip.id, 'contrast', { amount: 1.18 });
  addEffect(topClip.id, 'edge-detect', { strength: 0.72, invert: false });
  addPolygonMask(topClip.id, 'main polygon color mask', [
    { x: 0.1, y: 0.16 },
    { x: 0.72, y: 0.1 },
    { x: 0.92, y: 0.72 },
    { x: 0.38, y: 0.92 },
    { x: 0.06, y: 0.58 },
  ], { feather: 22, featherQuality: 72 });
  addNumericKeyframes(topClip.id, 'opacity', [
    { time: 0, value: 0.1 },
    { time: 1.1, value: 0.52 },
    { time: 3.4, value: 0.22 },
  ]);

  timelineStore.addMarker(0.25, 'fixture-start', '#59d38c');
  timelineStore.addMarker(3.2, 'transition-check', '#f5c542');
  timelineStore.addMarker(5.75, 'nested-export-check', '#5da7ff');
  timelineStore.setPlayheadPosition(0.25);
  saveActiveTimelineToComposition(mainComp.id, ctx.durationSeconds);
  engine.requestRender();
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  return useMediaStore.getState().compositions.find((entry) => entry.id === mainComp.id) ?? mainComp;
}

export async function handleCreateStressTestProjectFixture(
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal'
): Promise<ToolResult> {
  const startedAt = performance.now();
  const resetProject = args.resetProject !== false;
  const projectName = typeof args.projectName === 'string' && args.projectName.trim()
    ? args.projectName.trim()
    : `Bridge Stress Test Fixture ${new Date().toISOString()}`;
  const durationSeconds = finiteNumber(args.durationSeconds, 6.2, 2, 30);
  const width = Math.round(finiteNumber(args.width, 1920, 64, 7680));
  const height = Math.round(finiteNumber(args.height, 1080, 64, 4320));
  const frameRate = finiteNumber(args.frameRate, 24, 1, 240);

  try {
    const mediaStore = useMediaStore.getState();
    const timelineStore = useTimelineStore.getState();
    timelineStore.pause();

    if (resetProject) {
      mediaStore.newProject();
      await timelineStore.loadState(undefined);
      await waitForAnimationFrame();
    }

    useMediaStore.getState().setProjectName(projectName);
    const preparedMedia = await prepareImportedMedia(args, callerContext);
    if (preparedMedia.errors && preparedMedia.imported.length === 0) {
      return {
        success: false,
        error: 'No stress test fixture media could be imported',
        data: { errors: preparedMedia.errors },
      };
    }

    const freshMediaStore = useMediaStore.getState();
    const mainComp = freshMediaStore.compositions.find((entry) => entry.id === freshMediaStore.activeCompositionId)
      ?? freshMediaStore.compositions[0];
    if (!mainComp) {
      throw new Error('No active composition exists after project reset');
    }

    const ctx: FixtureBuildContext = {
      primary: preparedMedia.roles['primary-motion'],
      blend: preparedMedia.roles['blend-mask'],
      detail: preparedMedia.roles['detail-nested'],
      durationSeconds,
      width,
      height,
      frameRate,
    };

    const subComp = await buildSubComposition(ctx);
    const nestedComp = await buildNestedComposition(ctx, subComp);
    const activeMainComp = await buildMainComposition(ctx, mainComp, nestedComp);
    await openComposition(activeMainComp.id);
    await waitForAnimationFrame();
    engine.requestRender();

    const finalTimeline = useTimelineStore.getState();
    const finalMedia = useMediaStore.getState();
    const activeComposition = finalMedia.compositions.find((entry) => entry.id === activeMainComp.id) ?? activeMainComp;
    const summaries = finalMedia.compositions
      .filter((composition) => [
        activeMainComp.id,
        nestedComp.id,
        subComp.id,
      ].includes(composition.id))
      .map((composition) => composition.id === activeComposition.id
        ? summarizeActiveComposition(activeComposition)
        : summarizeStoredComposition(composition));

    return {
      success: true,
      data: {
        projectName,
        elapsedMs: Math.round(performance.now() - startedAt),
        activeCompositionId: activeComposition.id,
        activeCompositionName: activeComposition.name,
        imported: preparedMedia.imported,
        importErrors: preparedMedia.errors,
        mediaRoles: {
          primaryMotion: preparedMedia.roles['primary-motion'].id,
          blendMask: preparedMedia.roles['blend-mask'].id,
          detailNested: preparedMedia.roles['detail-nested'].id,
        },
        compositionSummaries: summaries,
        timeline: {
          duration: finalTimeline.duration,
          trackCount: finalTimeline.tracks.length,
          clipCount: finalTimeline.clips.length,
          clips: summarizeClips(finalTimeline.clips),
          markers: finalTimeline.markers.map((marker) => ({
            id: marker.id,
            time: marker.time,
            label: marker.label,
            color: marker.color,
          })),
        },
      },
    };
  } catch (error) {
    log.error('Failed to create stress test fixture', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: {
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}
