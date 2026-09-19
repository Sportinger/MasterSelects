import type { LiveInputSource } from '../../types/liveInput';
import type { VideoRotationDegrees } from '../../engine/webcodecs/videoTrackOrientation';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import { renderHostPort } from '../render/renderHostPort';

interface LiveInputRuntimeEntry {
  stream: MediaStream;
  video: HTMLVideoElement;
  source: LiveInputSource;
  feedbackCanvas?: HTMLCanvasElement;
  presentationVideoFrameStops: Map<HTMLVideoElement, () => void>;
  presentationCanvas: HTMLCanvasElement;
  presentationContext: CanvasRenderingContext2D | null;
  hasPresentationFrame: boolean;
  lastRenderedAt: number;
  cleanup: () => void;
}

interface PendingLiveInputConnection {
  source: LiveInputSource;
  connection: Promise<ConnectedLiveInput>;
}

export interface ConnectedLiveInput {
  label: string;
  video: HTMLVideoElement;
}

export interface LiveInputVideoPresentation {
  height: number;
  /** Rotation required only when sampling the stream through WebGPU. */
  rotation: VideoRotationDegrees;
  width: number;
}

const ACTIVE_RENDER_WINDOW_MS = 2000;
const IDLE_RENDER_PROBE_INTERVAL_MS = 500;
const LIVE_VIDEO_STALL_RECOVERY_MS = 3000;
const LIVE_VIDEO_RECOVERY_COOLDOWN_MS = 5000;
const LIVE_INPUT_PRESENTATION_FRAME_INTERVAL_MS = 1000 / 30;
const LIVE_INPUT_RUNTIME_IMPLEMENTATION_VERSION = 9;

export interface LiveInputReconnectOptions {
  showBulkPrompt?: boolean;
}

export function resolveLiveInputVideoPresentation(
  _source: LiveInputSource,
  videoWidth: number,
  videoHeight: number,
): LiveInputVideoPresentation {
  // Live input is staged through drawImage before WebGPU samples it. Browsers
  // apply the current device/camera display orientation there, including when
  // an iPad rotates after capture starts.
  return {
    width: Math.max(0, videoWidth),
    height: Math.max(0, videoHeight),
    rotation: 0,
  };
}

export function createLiveInputVideoElement(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('aria-hidden', 'true');
  Object.assign(video.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    // iPad Safari heavily throttles 1x1 MediaStream video presentation and can
    // leave that surface frozen after an orientation change. Keep a real
    // in-viewport presentation box while making it visually imperceptible.
    width: '160px',
    height: '90px',
    objectFit: 'cover',
    opacity: '0.001',
    pointerEvents: 'none',
  });
  document.body.appendChild(video);
  return video;
}

export function selectLiveInputPresentationVideo(
  fallback: HTMLVideoElement,
  stream: MediaStream,
  candidates: Iterable<HTMLVideoElement>,
): HTMLVideoElement {
  const orderedCandidates = [...candidates].reverse();
  const isUsableCandidate = (candidate: HTMLVideoElement) => (
    candidate.isConnected &&
    candidate.srcObject === stream &&
    candidate.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    candidate.videoWidth > 0 &&
    candidate.videoHeight > 0
  );
  return orderedCandidates.find((candidate) => (
    candidate.dataset.liveInputPresentationRole === 'media-panel'
    && isUsableCandidate(candidate)
  )) ?? orderedCandidates.find(isUsableCandidate) ?? fallback;
}

export function keepLiveInputVideoActive(
  video: HTMLVideoElement,
  stream: MediaStream,
): () => void {
  let disposed = false;
  let lastAdvancingMediaTime = video.currentTime;
  let lastAdvanceAt = performance.now();
  let lastRecoveryAt = -Infinity;
  const resume = () => {
    if (disposed || !stream.active || video.srcObject !== stream) return;
    void video.play().catch(() => undefined);
    renderHostPort.requestNewFrameRender();
  };
  const resumeWhenVisible = () => {
    if (document.visibilityState === 'visible') resume();
  };
  video.addEventListener('pause', resume);
  video.addEventListener('stalled', resume);
  document.addEventListener('visibilitychange', resumeWhenVisible);
  window.addEventListener('pageshow', resume);
  const tracks = stream.getVideoTracks();
  tracks.forEach((track) => track.addEventListener('unmute', resume));

  const watchdog = window.setInterval(() => {
    if (disposed || document.visibilityState !== 'visible' || !stream.active) return;
    const now = performance.now();
    const mediaTime = video.currentTime;
    if (Number.isFinite(mediaTime) && mediaTime > lastAdvancingMediaTime + 0.001) {
      lastAdvancingMediaTime = mediaTime;
      lastAdvanceAt = now;
      return;
    }
    if (video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      resume();
    }
    const hasLiveUnmutedTrack = tracks.some((track) => track.readyState === 'live' && !track.muted);
    if (
      hasLiveUnmutedTrack &&
      now - lastAdvanceAt >= LIVE_VIDEO_STALL_RECOVERY_MS &&
      now - lastRecoveryAt >= LIVE_VIDEO_RECOVERY_COOLDOWN_MS
    ) {
      // iPad Safari can leave a MediaStream-backed video logically playing
      // while its presentation clock no longer advances. Reattaching the same
      // stream restarts presentation without reacquiring camera permission.
      lastRecoveryAt = now;
      lastAdvanceAt = now;
      video.srcObject = null;
      video.srcObject = stream;
      resume();
    }
  }, 1000);

  return () => {
    disposed = true;
    window.clearInterval(watchdog);
    video.removeEventListener('pause', resume);
    video.removeEventListener('stalled', resume);
    document.removeEventListener('visibilitychange', resumeWhenVisible);
    window.removeEventListener('pageshow', resume);
    tracks.forEach((track) => track.removeEventListener('unmute', resume));
  };
}

function findPreviewCanvas(compositionId: string): HTMLCanvasElement | null {
  return [...document.querySelectorAll<HTMLCanvasElement>('.preview-container canvas.preview-canvas')]
    .find((canvas) => canvas.dataset.liveFeedbackCompositionId === compositionId) ?? null;
}

function getPreviewCanvas(compositionId: string): HTMLCanvasElement {
  const canvas = findPreviewCanvas(compositionId);
  if (!canvas) throw new Error('Open the composition preview before enabling feedback.');
  return canvas;
}

function createSoftwareFeedbackStream(source: HTMLCanvasElement): { stream: MediaStream; cleanup: () => void } {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 8192 / Math.max(source.width, source.height, 1));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Composition feedback needs a 2D canvas fallback on this platform.');
  if (!canvas.captureStream) throw new Error('Composition feedback is unavailable in this browser.');
  const stream = canvas.captureStream();

  let animationFrame = 0;
  const draw = () => {
    try {
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    } catch {
      // The preview canvas can be replaced while a composition tab changes.
    }
    animationFrame = requestAnimationFrame(draw);
  };
  draw();

  return {
    stream,
    cleanup: () => cancelAnimationFrame(animationFrame),
  };
}

async function acquireLiveInput(source: LiveInputSource): Promise<{
  stream: MediaStream;
  cleanup?: () => void;
  feedbackCanvas?: HTMLCanvasElement;
}> {
  if (source.kind === 'display') {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Display capture is unavailable in this browser.');
    return { stream: await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }) };
  }

  if (source.kind === 'video-device') {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture is unavailable in this browser.');
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        video: source.deviceId ? { deviceId: { exact: source.deviceId } } : true,
        audio: false,
      }),
    };
  }

  const canvas = getPreviewCanvas(source.compositionId);
  if (prefersSoftwareTimelineCanvas()) {
    const feedback = createSoftwareFeedbackStream(canvas);
    return { ...feedback, feedbackCanvas: canvas };
  }
  if (!canvas.captureStream) throw new Error('Composition feedback is unavailable in this browser.');
  return { stream: canvas.captureStream(), feedbackCanvas: canvas };
}

function stopAcquiredInput(stream: MediaStream, video: HTMLVideoElement, cleanup?: () => void): void {
  cleanup?.();
  video.pause();
  video.srcObject = null;
  video.remove();
  stream.getTracks().forEach((track) => track.stop());
}

function sourcesMatch(left: LiveInputSource, right: LiveInputSource): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'display') return true;
  if (left.kind === 'video-device' && right.kind === 'video-device') {
    return left.deviceId === right.deviceId;
  }
  return left.kind === 'composition-feedback' &&
    right.kind === 'composition-feedback' &&
    left.compositionId === right.compositionId;
}

export function requestRenderForVideoFrames(
  video: HTMLVideoElement,
  shouldRender: () => boolean = () => true,
  requestRender: () => void = () => renderHostPort.requestNewFrameRender(),
): () => void {
  let frameRequest = 0;
  let stopped = false;
  const onTimeUpdate = () => {
    if (!stopped && shouldRender()) requestRender();
  };

  if (typeof video.requestVideoFrameCallback === 'function') {
    const onFrame: VideoFrameRequestCallback = () => {
      if (stopped) return;
      if (shouldRender()) requestRender();
      frameRequest = video.requestVideoFrameCallback(onFrame);
    };
    frameRequest = video.requestVideoFrameCallback(onFrame);
  } else {
    video.addEventListener('timeupdate', onTimeUpdate);
  }

  return () => {
    stopped = true;
    if (frameRequest) video.cancelVideoFrameCallback(frameRequest);
    video.removeEventListener('timeupdate', onTimeUpdate);
  };
}

export function createLiveInputRenderGate(
  getLastRenderedAt: () => number,
  now: () => number = () => performance.now(),
): () => boolean {
  let lastIdleProbeAt = -Infinity;
  return () => {
    const currentTime = now();
    if (currentTime - getLastRenderedAt() < ACTIVE_RENDER_WINDOW_MS) return true;
    if (currentTime - lastIdleProbeAt < IDLE_RENDER_PROBE_INTERVAL_MS) return false;
    lastIdleProbeAt = currentTime;
    return true;
  };
}

export function resetLiveInputPresentationCanvas(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  // Retain both the DOM handle and its last valid dimensions until WebKit
  // exposes the first frame in the new orientation. A transient 1x1 resize
  // can poison the 2D GPU texture cache between orientation events.
  return canvas.getContext('2d', { alpha: false });
}

class LiveInputRuntime {
  private readonly entries = new Map<string, LiveInputRuntimeEntry>();
  private readonly pending = new Map<string, PendingLiveInputConnection>();
  private readonly connectionVersions = new Map<string, number>();
  private reconnectRequiredIds = new Set<string>();
  private bulkReconnectPromptIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChanged(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }

  private startPresentationFramePump(
    id: string,
    entry: LiveInputRuntimeEntry,
  ): () => void {
    let animationFrame = 0;
    let lastPresentedAt = -Infinity;
    const draw = (timestamp: number) => {
      if (this.entries.get(id) !== entry) return;
      if (
        document.visibilityState === 'visible'
        && timestamp - lastPresentedAt >= LIVE_INPUT_PRESENTATION_FRAME_INTERVAL_MS
      ) {
        lastPresentedAt = timestamp;
        this.updatePresentationCanvas(entry);
        renderHostPort.requestNewFrameRender();
      }
      animationFrame = window.requestAnimationFrame(draw);
    };
    animationFrame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(animationFrame);
  }

  connect(id: string, source: LiveInputSource): Promise<ConnectedLiveInput> {
    const pending = this.pending.get(id);
    if (pending && sourcesMatch(pending.source, source)) return pending.connection;

    const connectionVersion = (this.connectionVersions.get(id) ?? 0) + 1;
    this.connectionVersions.set(id, connectionVersion);

    const connection: Promise<ConnectedLiveInput> = acquireLiveInput(source).then(async ({ stream, cleanup, feedbackCanvas }) => {
      const video = createLiveInputVideoElement(stream);
      try {
        await video.play();
      } catch (error) {
        stopAcquiredInput(stream, video, cleanup);
        throw error;
      }

      const feedbackCanvasIsCurrent = source.kind !== 'composition-feedback' || (
        feedbackCanvas?.isConnected === true &&
        feedbackCanvas.dataset.liveFeedbackCompositionId === source.compositionId
      );
      if (this.connectionVersions.get(id) !== connectionVersion || !feedbackCanvasIsCurrent) {
        stopAcquiredInput(stream, video, cleanup);
        throw new DOMException('The live input connection was cancelled.', 'AbortError');
      }

      this.disposeEntry(id);
      const presentationCanvas = document.createElement('canvas');
      presentationCanvas.dataset.masterselectsDynamic = 'true';
      const entry: LiveInputRuntimeEntry = {
        stream,
        video,
        source,
        feedbackCanvas,
        presentationVideoFrameStops: new Map(),
        presentationCanvas,
        presentationContext: presentationCanvas.getContext('2d', { alpha: false }),
        hasPresentationFrame: false,
        lastRenderedAt: 0,
        cleanup: cleanup ?? (() => undefined),
      };
      const stopFrameRendering = requestRenderForVideoFrames(
        video,
        createLiveInputRenderGate(() => entry.lastRenderedAt),
        () => {
          this.updatePresentationCanvas(entry);
          renderHostPort.requestNewFrameRender();
        },
      );
      const stopPlaybackRecovery = keepLiveInputVideoActive(video, stream);
      const stopPresentationFramePump = this.startPresentationFramePump(id, entry);
      entry.cleanup = () => {
        stopFrameRendering();
        stopPlaybackRecovery();
        stopPresentationFramePump();
        entry.presentationVideoFrameStops.forEach((stop) => stop());
        entry.presentationVideoFrameStops.clear();
        cleanup?.();
      };
      this.entries.set(id, entry);
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (this.entries.get(id) !== entry) return;
          this.release(id);
          this.requireReconnect(id);
        }, { once: true });
      }
      this.reconnectRequiredIds.delete(id);
      this.bulkReconnectPromptIds.delete(id);
      this.notifyChanged();
      renderHostPort.requestNewFrameRender();
      return { video, label: stream.getVideoTracks()[0]?.label || 'Live Input' };
    }).finally(() => {
      if (this.pending.get(id)?.connection !== connection) return;
      this.pending.delete(id);
    });

    this.pending.set(id, { source, connection });
    return connection;
  }

  getVideoElement(id: string | undefined, markRendered = false): HTMLVideoElement | null {
    if (!id) return null;
    const entry = this.entries.get(id);
    if (entry && markRendered) entry.lastRenderedAt = performance.now();
    return entry?.video ?? null;
  }

  getPresentationVideoElement(id: string | undefined): HTMLVideoElement | null {
    if (!id) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    return selectLiveInputPresentationVideo(
      entry.video,
      entry.stream,
      entry.presentationVideoFrameStops.keys(),
    );
  }

  getVideoPresentation(id: string | undefined): LiveInputVideoPresentation | null {
    if (!id) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    const video = this.getPresentationVideoElement(id) ?? entry.video;
    return resolveLiveInputVideoPresentation(
      entry.source,
      video.videoWidth,
      video.videoHeight,
    );
  }

  private updatePresentationCanvas(
    entry: LiveInputRuntimeEntry,
    preferredVideo?: HTMLVideoElement,
  ): HTMLCanvasElement | null {
    if (!entry.presentationContext) return null;
    const video = preferredVideo ?? selectLiveInputPresentationVideo(
      entry.video,
      entry.stream,
      entry.presentationVideoFrameStops.keys(),
    );
    const { presentationCanvas: canvas, presentationContext: context } = entry;
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    ) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        entry.hasPresentationFrame = true;
      } catch {
        // Preserve the previous successfully staged frame during a transient
        // stream transition or device rotation.
      }
    }
    return entry.hasPresentationFrame ? canvas : null;
  }

  private resetPresentationCanvas(entry: LiveInputRuntimeEntry): void {
    // Keep the canvas object stable: render layers retain this runtime handle.
    // Replacing it on iPad rotation leaves WebGPU sampling the old frozen
    // surface until another timeline mutation happens to rebuild the layer.
    entry.presentationContext = resetLiveInputPresentationCanvas(entry.presentationCanvas);
    entry.hasPresentationFrame = false;
  }

  private startPresentationVideoFrames(
    id: string,
    entry: LiveInputRuntimeEntry,
    video: HTMLVideoElement,
  ): void {
    const stopFrameRendering = requestRenderForVideoFrames(
      video,
      // A visible native presentation surface is already browser-throttled to
      // the camera cadence. Keep the editor at that cadence too; WebKit can
      // otherwise fall into the idle-probe path after a couple of seconds.
      () => true,
      () => {
        if (this.entries.get(id) !== entry) return;
        const activeVideo = selectLiveInputPresentationVideo(
          entry.video,
          entry.stream,
          entry.presentationVideoFrameStops.keys(),
        );
        if (activeVideo !== video) return;
        this.updatePresentationCanvas(entry, video);
        renderHostPort.requestNewFrameRender();
      },
    );
    entry.presentationVideoFrameStops.set(video, stopFrameRendering);
  }

  getPresentationCanvas(id: string | undefined): HTMLCanvasElement | null {
    if (!id) return null;
    const entry = this.entries.get(id);
    return entry ? this.updatePresentationCanvas(entry) : null;
  }

  registerPresentationVideo(id: string, video: HTMLVideoElement): () => void {
    const entry = this.entries.get(id);
    if (!entry || video.srcObject !== entry.stream) return () => undefined;

    if (!entry.presentationVideoFrameStops.has(video)) {
      this.startPresentationVideoFrames(id, entry, video);
    }
    this.updatePresentationCanvas(entry, video);
    renderHostPort.requestNewFrameRender();

    return () => {
      const stopFrameRendering = entry.presentationVideoFrameStops.get(video);
      if (!stopFrameRendering) return;
      stopFrameRendering();
      entry.presentationVideoFrameStops.delete(video);
      renderHostPort.requestNewFrameRender();
    };
  }

  refreshPresentationVideo(id: string, video: HTMLVideoElement): void {
    const entry = this.entries.get(id);
    if (!entry || !entry.presentationVideoFrameStops.has(video)) return;

    entry.presentationVideoFrameStops.get(video)?.();
    entry.presentationVideoFrameStops.delete(video);
    this.resetPresentationCanvas(entry);

    // WebKit can keep the MediaStream clock advancing while drawImage and
    // requestVideoFrameCallback remain attached to the pre-rotation surface.
    // Reattaching the same stream discards that surface without reacquiring
    // the camera or showing a second permission prompt.
    video.pause();
    video.srcObject = null;
    video.srcObject = entry.stream;
    void video.play().catch(() => undefined);
    this.startPresentationVideoFrames(id, entry, video);
    renderHostPort.requestNewFrameRender();
  }

  getRevision(): number {
    return this.revision;
  }

  usesPersistentConnectionVersions(): true {
    return true;
  }

  getImplementationVersion(): number {
    return LIVE_INPUT_RUNTIME_IMPLEMENTATION_VERSION;
  }

  getReconnectRequiredIds(): readonly string[] {
    return [...this.reconnectRequiredIds];
  }

  getBulkReconnectPromptIds(): readonly string[] {
    return [...this.bulkReconnectPromptIds];
  }

  dismissBulkReconnectPrompt(): void {
    if (this.bulkReconnectPromptIds.size === 0) return;
    this.bulkReconnectPromptIds.clear();
    this.notifyChanged();
  }

  setReconnectRequiredIds(ids: Iterable<string>, options: LiveInputReconnectOptions = {}): void {
    const next = new Set(ids);
    const nextBulkPromptIds = options.showBulkPrompt
      ? new Set(next)
      : new Set([...this.bulkReconnectPromptIds].filter((id) => next.has(id)));
    if (
      next.size === this.reconnectRequiredIds.size &&
      [...next].every((id) => this.reconnectRequiredIds.has(id)) &&
      nextBulkPromptIds.size === this.bulkReconnectPromptIds.size &&
      [...nextBulkPromptIds].every((id) => this.bulkReconnectPromptIds.has(id))
    ) return;
    this.reconnectRequiredIds = next;
    this.bulkReconnectPromptIds = nextBulkPromptIds;
    this.notifyChanged();
  }

  private requireReconnect(id: string): void {
    if (this.reconnectRequiredIds.has(id)) return;
    this.reconnectRequiredIds.add(id);
    this.notifyChanged();
  }

  syncCompositionFeedbackSources(inputs: ReadonlyArray<{ id: string; source: LiveInputSource }>): void {
    const inputIds = new Set(inputs.map((input) => input.id));
    for (const [id, entry] of this.entries) {
      if (entry.source.kind !== 'composition-feedback') continue;
      const canvasIsCurrent = entry.feedbackCanvas?.isConnected === true &&
        entry.feedbackCanvas.dataset.liveFeedbackCompositionId === entry.source.compositionId;
      if (!inputIds.has(id) || !canvasIsCurrent) this.release(id);
    }

    for (const input of inputs) {
      if (
        input.source.kind !== 'composition-feedback' ||
        this.entries.has(input.id) ||
        this.pending.has(input.id) ||
        !findPreviewCanvas(input.source.compositionId)
      ) continue;
      void this.connect(input.id, input.source).catch(() => undefined);
    }
  }

  release(id: string): void {
    this.connectionVersions.set(id, (this.connectionVersions.get(id) ?? 0) + 1);
    const reconnectRequirementRemoved = this.reconnectRequiredIds.delete(id);
    const bulkPromptRemoved = this.bulkReconnectPromptIds.delete(id);
    const hadEntry = this.entries.has(id);
    this.disposeEntry(id);
    if ((reconnectRequirementRemoved || bulkPromptRemoved) && !hadEntry) this.notifyChanged();
  }

  private disposeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.cleanup?.();
    entry.video.pause();
    entry.video.srcObject = null;
    entry.video.remove();
    entry.stream.getTracks().forEach((track) => track.stop());
    this.notifyChanged();
    renderHostPort.requestNewFrameRender();
  }

  clear(): void {
    for (const id of this.pending.keys()) {
      this.connectionVersions.set(id, (this.connectionVersions.get(id) ?? 0) + 1);
    }
    this.pending.clear();
    for (const id of [...this.entries.keys()]) this.release(id);
    this.setReconnectRequiredIds([]);
  }
}

let sharedLiveInputRuntime = import.meta.hot?.data?.liveInputRuntime as LiveInputRuntime | undefined;
if (
  sharedLiveInputRuntime &&
  (
    typeof sharedLiveInputRuntime.subscribe !== 'function' ||
    typeof sharedLiveInputRuntime.usesPersistentConnectionVersions !== 'function' ||
    typeof sharedLiveInputRuntime.registerPresentationVideo !== 'function' ||
    typeof sharedLiveInputRuntime.refreshPresentationVideo !== 'function' ||
    typeof sharedLiveInputRuntime.getBulkReconnectPromptIds !== 'function' ||
    sharedLiveInputRuntime.getImplementationVersion?.() !== LIVE_INPUT_RUNTIME_IMPLEMENTATION_VERSION ||
    typeof sharedLiveInputRuntime.getVideoPresentation !== 'function' ||
    typeof sharedLiveInputRuntime.getPresentationVideoElement !== 'function' ||
    typeof sharedLiveInputRuntime.getPresentationCanvas !== 'function'
  )
) {
  sharedLiveInputRuntime.clear();
  sharedLiveInputRuntime = undefined;
}
sharedLiveInputRuntime ??= new LiveInputRuntime();

export const liveInputRuntime = sharedLiveInputRuntime;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.liveInputRuntime = liveInputRuntime;
  });
}
