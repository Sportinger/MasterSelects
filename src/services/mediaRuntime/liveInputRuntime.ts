import type { LiveInputSource } from '../../types/liveInput';
import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import { renderHostPort } from '../render/renderHostPort';

interface LiveInputRuntimeEntry {
  stream: MediaStream;
  video: HTMLVideoElement;
  source: LiveInputSource;
  feedbackCanvas?: HTMLCanvasElement;
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

function createVideoElement(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  return video;
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
  video.pause();
  video.srcObject = null;
  stream.getTracks().forEach((track) => track.stop());
  cleanup?.();
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

class LiveInputRuntime {
  private readonly entries = new Map<string, LiveInputRuntimeEntry>();
  private readonly pending = new Map<string, PendingLiveInputConnection>();
  private readonly connectionVersions = new Map<string, number>();
  private reconnectRequiredIds = new Set<string>();
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

  connect(id: string, source: LiveInputSource): Promise<ConnectedLiveInput> {
    const pending = this.pending.get(id);
    if (pending && sourcesMatch(pending.source, source)) return pending.connection;

    const connectionVersion = (this.connectionVersions.get(id) ?? 0) + 1;
    this.connectionVersions.set(id, connectionVersion);

    const connection: Promise<ConnectedLiveInput> = acquireLiveInput(source).then(async ({ stream, cleanup, feedbackCanvas }) => {
      const video = createVideoElement(stream);
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
      const entry: LiveInputRuntimeEntry = {
        stream,
        video,
        source,
        feedbackCanvas,
        lastRenderedAt: 0,
        cleanup: cleanup ?? (() => undefined),
      };
      const stopFrameRendering = requestRenderForVideoFrames(
        video,
        () => performance.now() - entry.lastRenderedAt < 2000,
      );
      entry.cleanup = () => {
        stopFrameRendering();
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

  getRevision(): number {
    return this.revision;
  }

  usesPersistentConnectionVersions(): true {
    return true;
  }

  getReconnectRequiredIds(): readonly string[] {
    return [...this.reconnectRequiredIds];
  }

  setReconnectRequiredIds(ids: Iterable<string>): void {
    const next = new Set(ids);
    if (
      next.size === this.reconnectRequiredIds.size &&
      [...next].every((id) => this.reconnectRequiredIds.has(id))
    ) return;
    this.reconnectRequiredIds = next;
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
    const hadEntry = this.entries.has(id);
    this.disposeEntry(id);
    if (reconnectRequirementRemoved && !hadEntry) this.notifyChanged();
  }

  private disposeEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    entry.video.pause();
    entry.video.srcObject = null;
    entry.stream.getTracks().forEach((track) => track.stop());
    entry.cleanup?.();
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
    typeof sharedLiveInputRuntime.usesPersistentConnectionVersions !== 'function'
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
