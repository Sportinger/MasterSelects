import type { TimelineClip } from '../../types/timeline';
import { normalizeMotionReplicatorBundle } from '../../services/motionDesign/contracts/replicatorTimelineAdapter';
import { MOTION_REPLICATOR_SHADER_MAX_INSTANCES } from './MotionTypes';

export interface MotionTimelineDiagnostics {
  totalClips: number;
  activeClips: number;
  renderableClips: number;
  unsupportedClips: number;
  rectangleClips: number;
  ellipseClips: number;
  polygonClips: number;
  starClips: number;
  replicatorClips: number;
  effectiveInstances: number;
  activeEffectiveInstances: number;
}

export interface MotionRendererDiagnostics {
  renderCalls: number;
  cacheCount: number;
  bufferUploads: number;
  bufferUploadBytes: number;
  totalInstances: number;
  lastInstanceCount: number;
  peakInstanceCount: number;
  lastEncodeTimeMs: number;
  averageEncodeTimeMs: number;
  maxEncodeTimeMs: number;
  lastLayerId: string | null;
  lastSourceClipId: string | null;
  lastRenderedAt: number | null;
}

export type MotionTextureDiagnosticCode =
  | 'TEXTURE_MEDIA_MISSING'
  | 'TEXTURE_SLOT_EXCEEDED';

export interface MotionTextureDiagnostic {
  code: MotionTextureDiagnosticCode;
  message: string;
  appearanceId?: string;
}

interface MotionRenderSample {
  layerId: string;
  sourceClipId?: string;
  instanceCount: number;
  bufferUploads: number;
  bufferUploadBytes: number;
  encodeTimeMs: number;
  renderedAt: number;
}

const rendererDiagnostics: MotionRendererDiagnostics = {
  renderCalls: 0,
  cacheCount: 0,
  bufferUploads: 0,
  bufferUploadBytes: 0,
  totalInstances: 0,
  lastInstanceCount: 0,
  peakInstanceCount: 0,
  lastEncodeTimeMs: 0,
  averageEncodeTimeMs: 0,
  maxEncodeTimeMs: 0,
  lastLayerId: null,
  lastSourceClipId: null,
  lastRenderedAt: null,
};

const textureDiagnostics: MotionTextureDiagnostic[] = [];

function isActiveAt(clip: TimelineClip, time: number): boolean {
  return time >= clip.startTime && time < clip.startTime + clip.duration;
}

function getConfiguredReplicatorInstanceCount(
  clip: TimelineClip,
): { enabled: boolean; instanceCount: number } {
  const motion = clip.motion;
  if (!motion?.replicator) return { enabled: false, instanceCount: 1 };
  try {
    const replicator = normalizeMotionReplicatorBundle(
      motion.replicator,
      motion.modifierStack,
    ).replicator;
    if (!replicator.enabled) return { enabled: false, instanceCount: 1 };
    const requestedCount = replicator.layout.mode === 'grid'
      ? replicator.layout.count.columns * replicator.layout.count.rows
      : replicator.layout.count;
    const configuredLimit = Math.min(
      replicator.userLimit ?? MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
      MOTION_REPLICATOR_SHADER_MAX_INSTANCES,
    );
    return {
      enabled: true,
      instanceCount: Math.min(requestedCount, configuredLimit),
    };
  } catch {
    return { enabled: false, instanceCount: 0 };
  }
}

export function buildMotionTimelineDiagnostics(
  clips: readonly TimelineClip[],
  playheadPosition: number,
): MotionTimelineDiagnostics {
  const snapshot: MotionTimelineDiagnostics = {
    totalClips: 0,
    activeClips: 0,
    renderableClips: 0,
    unsupportedClips: 0,
    rectangleClips: 0,
    ellipseClips: 0,
    polygonClips: 0,
    starClips: 0,
    replicatorClips: 0,
    effectiveInstances: 0,
    activeEffectiveInstances: 0,
  };

  for (const clip of clips) {
    if (clip.source?.type !== 'motion-shape' || clip.motion?.kind !== 'shape') {
      continue;
    }

    snapshot.totalClips += 1;
    const active = isActiveAt(clip, playheadPosition);
    if (active) snapshot.activeClips += 1;

    const primitive = clip.motion.shape?.primitive;
    if (primitive === 'rectangle') {
      snapshot.rectangleClips += 1;
      snapshot.renderableClips += 1;
    } else if (primitive === 'ellipse') {
      snapshot.ellipseClips += 1;
      snapshot.renderableClips += 1;
    } else if (primitive === 'polygon') {
      snapshot.polygonClips += 1;
      snapshot.renderableClips += 1;
    } else if (primitive === 'star') {
      snapshot.starClips += 1;
      snapshot.renderableClips += 1;
    } else {
      snapshot.unsupportedClips += 1;
    }

    // Timeline/AI diagnostics describe persisted configuration. They must not
    // execute the render evaluator outside the admitted MotionFrameState path.
    const replicator = getConfiguredReplicatorInstanceCount(clip);
    if (replicator.enabled) snapshot.replicatorClips += 1;
    snapshot.effectiveInstances += replicator.instanceCount;
    if (active) snapshot.activeEffectiveInstances += replicator.instanceCount;
  }

  return snapshot;
}

export function recordMotionRender(sample: MotionRenderSample): void {
  const previousCalls = rendererDiagnostics.renderCalls;
  const nextCalls = previousCalls + 1;
  const encodeTimeMs = Number.isFinite(sample.encodeTimeMs)
    ? Math.max(0, sample.encodeTimeMs)
    : 0;
  const instanceCount = Number.isFinite(sample.instanceCount)
    ? Math.max(0, Math.round(sample.instanceCount))
    : 0;

  rendererDiagnostics.renderCalls = nextCalls;
  rendererDiagnostics.bufferUploads += Math.max(0, Math.round(sample.bufferUploads));
  rendererDiagnostics.bufferUploadBytes += Math.max(0, Math.round(sample.bufferUploadBytes));
  rendererDiagnostics.totalInstances += instanceCount;
  rendererDiagnostics.lastInstanceCount = instanceCount;
  rendererDiagnostics.peakInstanceCount = Math.max(
    rendererDiagnostics.peakInstanceCount,
    instanceCount,
  );
  rendererDiagnostics.lastEncodeTimeMs = encodeTimeMs;
  rendererDiagnostics.averageEncodeTimeMs = (
    rendererDiagnostics.averageEncodeTimeMs * previousCalls + encodeTimeMs
  ) / nextCalls;
  rendererDiagnostics.maxEncodeTimeMs = Math.max(
    rendererDiagnostics.maxEncodeTimeMs,
    encodeTimeMs,
  );
  rendererDiagnostics.lastLayerId = sample.layerId;
  rendererDiagnostics.lastSourceClipId = sample.sourceClipId ?? null;
  rendererDiagnostics.lastRenderedAt = sample.renderedAt;
}

export function setMotionRendererCacheCount(cacheCount: number): void {
  rendererDiagnostics.cacheCount = Number.isFinite(cacheCount)
    ? Math.max(0, Math.round(cacheCount))
    : 0;
}

export function recordMotionTextureDiagnostic(diagnostic: MotionTextureDiagnostic): void {
  if (textureDiagnostics.some((entry) => (
    entry.code === diagnostic.code
    && entry.message === diagnostic.message
    && entry.appearanceId === diagnostic.appearanceId
  ))) return;
  textureDiagnostics.push({ ...diagnostic });
  if (textureDiagnostics.length > 100) textureDiagnostics.shift();
}

export function getMotionTextureDiagnostics(): readonly MotionTextureDiagnostic[] {
  return textureDiagnostics.map((diagnostic) => ({ ...diagnostic }));
}

export function getMotionRendererDiagnostics(): MotionRendererDiagnostics {
  return { ...rendererDiagnostics };
}

export function resetMotionRendererDiagnostics(): void {
  Object.assign(rendererDiagnostics, {
    renderCalls: 0,
    cacheCount: 0,
    bufferUploads: 0,
    bufferUploadBytes: 0,
    totalInstances: 0,
    lastInstanceCount: 0,
    peakInstanceCount: 0,
    lastEncodeTimeMs: 0,
    averageEncodeTimeMs: 0,
    maxEncodeTimeMs: 0,
    lastLayerId: null,
    lastSourceClipId: null,
    lastRenderedAt: null,
  } satisfies MotionRendererDiagnostics);
  textureDiagnostics.length = 0;
}
