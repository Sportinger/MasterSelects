// Live camera views for the Multi Preview in multicam mode. Every angle keeps a
// decoder advancing with the timeline, also while its track is cut out of the
// program. Codec-provider angles (MXF) share the program track's decode session
// (interactive-track:<trackId>:<source>), so a cut to that camera finds its
// decoder warm; other media play through a muted <video> element kept in sync.

import type { Layer } from '../../types/layers';
import type { BlendMode } from '../../types/blendMode';
import type { TimelineClip } from '../../types/timeline';
import type { CompositionMulticam, MulticamAngle, MulticamAngleSource } from '../../types/multicam';
import { useMediaStore } from '../../stores/mediaStore';
import { getEffectiveScale } from '../../utils/transformScale';
import { bindSourceRuntimeForOwner } from '../mediaRuntime/clipBindings';
import { mediaRuntimeRegistry } from '../mediaRuntime/registry';
import {
  ensureRuntimeFrameProvider,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  isProviderBackedRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import { Logger } from '../logger';

const log = Logger.create('MulticamAngles');

/** Seeks while paused only when the view is this far off (seconds). */
const PAUSED_SEEK_TOLERANCE = 0.02;
/** A playing <video> is re-synced only past this drift (seconds). */
const PLAYING_DRIFT_TOLERANCE = 0.15;
/**
 * While the playhead is dragged the angles hold their picture until it rests
 * this long (ms): every long-GOP seek decodes from the key frame, and angle
 * seeks per mouse move starved the program's scrub decoder.
 */
const SCRUB_SETTLE_MS = 120;

const scrubState = { time: Number.NaN, movedAt: 0 };

/**
 * The latest picture a <video> presented, as a VideoFrame. The view then renders
 * like a decoder frame and keeps its last picture while the element seeks.
 */
class ElementFrameTap {
  private readonly element: HTMLVideoElement;
  private frame: VideoFrame | null = null;
  private callbackId: number | null = null;
  private closed = false;
  private readonly onSeeked = () => this.capture(this.element.currentTime);

  constructor(element: HTMLVideoElement) {
    this.element = element;
    element.addEventListener('seeked', this.onSeeked);
    element.addEventListener('loadeddata', this.onSeeked);
    this.requestNext();
  }

  get currentFrame(): VideoFrame | null {
    return this.frame;
  }

  close(): void {
    this.closed = true;
    this.element.removeEventListener('seeked', this.onSeeked);
    this.element.removeEventListener('loadeddata', this.onSeeked);
    if (this.callbackId !== null) this.element.cancelVideoFrameCallback(this.callbackId);
    this.frame?.close();
    this.frame = null;
  }

  private requestNext(): void {
    if (this.closed || typeof this.element.requestVideoFrameCallback !== 'function') return;
    this.callbackId = this.element.requestVideoFrameCallback((_now, metadata) => {
      this.capture(metadata.mediaTime);
      this.requestNext();
    });
  }

  private capture(mediaTime: number): void {
    if (this.closed || this.element.readyState < 2) return;
    try {
      const next = new VideoFrame(this.element, { timestamp: Math.round(mediaTime * 1e6) });
      this.frame?.close();
      this.frame = next;
    } catch {
      // No presentable frame yet; keep the previous picture.
    }
  }
}

type AngleSourceRuntime =
  | { kind: 'provider'; ownerId: string; runtimeSourceId: string; source: TimelineClip['source'] }
  | { kind: 'element'; element: HTMLVideoElement; url: string; frames: ElementFrameTap };

const runtimes = new Map<string, AngleSourceRuntime>();

function runtimeKey(compositionId: string, angleIndex: number, source: MulticamAngleSource): string {
  return `${compositionId}:${angleIndex}:${source.mediaFileId}:${source.startTime}`;
}

export interface AngleSourceAtTime {
  source: MulticamAngleSource;
  sourceTime: number;
}

export function resolveAngleSourceAt(angle: MulticamAngle, time: number): AngleSourceAtTime | null {
  const source = angle.sources.find((candidate) => time >= candidate.startTime && time < candidate.startTime + candidate.duration);
  return source ? { source, sourceTime: source.inPoint + (time - source.startTime) } : null;
}

function createRuntime(compositionId: string, angleIndex: number, angle: MulticamAngle, source: MulticamAngleSource): AngleSourceRuntime | null {
  const mediaFile = useMediaStore.getState().files.find((file) => file.id === source.mediaFileId);
  if (!mediaFile?.file) return null;
  const ownerId = `multicam-angle:${runtimeKey(compositionId, angleIndex, source)}`;
  const bound = bindSourceRuntimeForOwner({
    ownerId,
    source: { type: 'video', mediaFileId: source.mediaFileId, naturalDuration: mediaFile.duration ?? source.duration },
    file: mediaFile.file,
    mediaFileId: source.mediaFileId,
    filePath: mediaFile.absolutePath ?? mediaFile.filePath,
  });
  if (bound?.runtimeSourceId && isProviderBackedRuntimeSource(bound)) {
    // Same session key as the program clips on this camera's track.
    return { kind: 'provider', ownerId, runtimeSourceId: bound.runtimeSourceId, source: getPreviewRuntimeSource(bound, angle.trackId) };
  }
  if (bound?.runtimeSourceId) mediaRuntimeRegistry.releaseRuntime(bound.runtimeSourceId, ownerId);
  const element = document.createElement('video');
  const url = URL.createObjectURL(mediaFile.file);
  element.muted = true;
  element.playsInline = true;
  element.preload = 'auto';
  element.src = url;
  return { kind: 'element', element, url, frames: new ElementFrameTap(element) };
}

function releaseRuntime(runtime: AngleSourceRuntime): void {
  if (runtime.kind === 'provider') {
    mediaRuntimeRegistry.releaseRuntime(runtime.runtimeSourceId, runtime.ownerId);
    return;
  }
  runtime.frames.close();
  runtime.element.pause();
  runtime.element.removeAttribute('src');
  runtime.element.load();
  URL.revokeObjectURL(runtime.url);
}

function getRuntime(compositionId: string, angleIndex: number, angle: MulticamAngle, source: MulticamAngleSource): AngleSourceRuntime | null {
  const key = runtimeKey(compositionId, angleIndex, source);
  const existing = runtimes.get(key);
  if (existing) return existing;
  const created = createRuntime(compositionId, angleIndex, angle, source);
  if (created) runtimes.set(key, created);
  return created;
}

function driveProvider(runtime: Extract<AngleSourceRuntime, { kind: 'provider' }>, sourceTime: number, isPlaying: boolean): void {
  updateRuntimePlaybackTime(runtime.source, sourceTime);
  const provider = getRuntimeFrameProvider(runtime.source);
  if (!provider) {
    void ensureRuntimeFrameProvider(runtime.source, 'interactive', sourceTime).catch((error: unknown) => {
      log.warn('Angle decoder failed to start', { error });
    });
    return;
  }
  if (isPlaying && provider.advanceToTime) provider.advanceToTime(sourceTime);
  else if (Math.abs(provider.currentTime - sourceTime) > PAUSED_SEEK_TOLERANCE) provider.seek(sourceTime);
}

function driveElement(element: HTMLVideoElement, sourceTime: number, isPlaying: boolean): void {
  if (isPlaying) {
    if (Math.abs(element.currentTime - sourceTime) > PLAYING_DRIFT_TOLERANCE) element.currentTime = sourceTime;
    if (element.paused) void element.play().catch(() => undefined);
    return;
  }
  if (!element.paused) element.pause();
  if (Math.abs(element.currentTime - sourceTime) > PAUSED_SEEK_TOLERANCE) element.currentTime = sourceTime;
}

/**
 * Advances every angle to `time`. While playing, a codec angle that is the
 * program at `time` is driven by the timeline sync already (same session) and
 * is left alone; paused, both ask for the same frame.
 */
export function syncMulticamAngles(params: {
  compositionId: string;
  multicam: CompositionMulticam;
  time: number;
  isPlaying: boolean;
  isDragging: boolean;
  programClips: readonly TimelineClip[];
}): void {
  const { compositionId, multicam, time, isPlaying, isDragging, programClips } = params;
  const now = performance.now();
  if (time !== scrubState.time) {
    scrubState.time = time;
    scrubState.movedAt = now;
  }
  const holdForScrub = isDragging && now - scrubState.movedAt < SCRUB_SETTLE_MS;
  const live = new Set<string>();
  multicam.angles.forEach((angle, angleIndex) => {
    const resolved = resolveAngleSourceAt(angle, time);
    if (!resolved) return;
    const runtime = getRuntime(compositionId, angleIndex, angle, resolved.source);
    if (!runtime) return;
    live.add(runtimeKey(compositionId, angleIndex, resolved.source));
    if (holdForScrub) return;
    if (runtime.kind === 'element') {
      driveElement(runtime.element, resolved.sourceTime, isPlaying);
      return;
    }
    const isProgram = isPlaying && programClips.some((clip) => clip.trackId === angle.trackId
      && time >= clip.startTime && time < clip.startTime + clip.duration);
    if (!isProgram) driveProvider(runtime, resolved.sourceTime, isPlaying);
  });
  // Sources the playhead has left (e.g. Jonas1 after the switch to Jonas2) give their decoders back.
  for (const [key, runtime] of runtimes) {
    if (live.has(key)) continue;
    releaseRuntime(runtime);
    runtimes.delete(key);
  }
}

/** The angle's current frame as a preview layer, or null where the camera has no material. */
export function getMulticamAngleLayer(
  compositionId: string,
  multicam: CompositionMulticam,
  angleIndex: number,
  time: number,
): Layer | null {
  const angle = multicam.angles[angleIndex];
  const resolved = angle ? resolveAngleSourceAt(angle, time) : null;
  if (!angle || !resolved) return null;
  const runtime = runtimes.get(runtimeKey(compositionId, angleIndex, resolved.source));
  if (!runtime) return null;
  const transform = resolved.source.template.transform;
  const base = {
    id: `multicam-angle-${compositionId}-${angleIndex}`,
    name: angle.label,
    visible: true,
    opacity: 1,
    blendMode: 'normal' as BlendMode,
    effects: resolved.source.template.effects,
    position: { x: transform.position?.x || 0, y: transform.position?.y || 0, z: transform.position?.z || 0 },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: ((transform.rotation?.x || 0) * Math.PI) / 180,
      y: ((transform.rotation?.y || 0) * Math.PI) / 180,
      z: ((transform.rotation?.z || 0) * Math.PI) / 180,
    },
  };
  if (runtime.kind === 'element') {
    const videoFrame = runtime.frames.currentFrame ?? undefined;
    return { ...base, source: { type: 'video', videoFrame } } as Layer;
  }
  return {
    ...base,
    source: {
      type: 'video',
      webCodecsPlayer: getRuntimeFrameProvider(runtime.source) ?? undefined,
      runtimeSourceId: runtime.source?.runtimeSourceId,
      runtimeSessionKey: runtime.source?.runtimeSessionKey,
    },
  } as Layer;
}

/**
 * Whether the angle layer has a frame to show. A decoder catching up keeps the
 * slot on its last picture instead of flashing black.
 */
export function isMulticamAngleLayerReady(layer: Layer): boolean {
  return Boolean(layer.source?.videoFrame ?? layer.source?.webCodecsPlayer?.getCurrentFrame?.());
}

/** Per-angle decoder state for getStats. */
export function getMulticamAngleDebugSnapshot() {
  return [...runtimes].map(([key, runtime]) => {
    if (runtime.kind === 'element') {
      const { element } = runtime;
      return {
        key, kind: runtime.kind, readyState: element.readyState, currentTime: element.currentTime,
        paused: element.paused, seeking: element.seeking, error: element.error?.message ?? element.error?.code ?? null,
        frameTime: runtime.frames.currentFrame ? runtime.frames.currentFrame.timestamp / 1e6 : null,
      };
    }
    const provider = getRuntimeFrameProvider(runtime.source);
    return {
      key, kind: runtime.kind, sessionKey: runtime.source?.runtimeSessionKey ?? null,
      hasProvider: Boolean(provider), currentTime: provider?.currentTime ?? null,
      hasFrame: Boolean(provider?.getCurrentFrame?.()),
    };
  });
}

/** Gives every angle decoder back (cut mode off, Multi Preview closed). */
export function releaseMulticamAngles(): void {
  for (const runtime of runtimes.values()) releaseRuntime(runtime);
  runtimes.clear();
}

