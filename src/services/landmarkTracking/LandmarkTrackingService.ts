import type {
  FaceLandmarker,
  HandLandmarker,
  ImageSource,
  NormalizedLandmark,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { Logger } from '../logger';
import { useLandmarkTrackingStore } from '../../stores/landmarkTrackingStore';
import { landmarkRuntime } from './landmarkRuntime';
import { saveLandmarkSidecar } from './landmarkSidecar';
import { loadLandmarkModel } from './modelCatalog';
import type {
  LandmarkFrame,
  LandmarkKind,
  LandmarkPoint,
  LandmarkSeries,
  LandmarkTrackingRequest,
} from './types';

const log = Logger.create('LandmarkTracking');

function points(landmarks: NormalizedLandmark[][] | undefined): LandmarkPoint[][] {
  return (landmarks ?? []).map((group) => group.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: Number.isFinite(point.visibility) ? point.visibility : undefined,
  })));
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Video seek timed out at ${time.toFixed(3)}s`));
    }, 8_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
    const handleSeeked = () => { cleanup(); resolve(); };
    const handleError = () => { cleanup(); reject(new Error('Video could not provide a tracking frame')); };
    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = time;
  });
}

class LandmarkTrackingService {
  private module: typeof import('@mediapipe/tasks-vision') | null = null;
  private hand: HandLandmarker | null = null;
  private face: FaceLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private cancelled = false;
  private running = false;
  private lastTimestampMs = 0;

  private async ensureModule(): Promise<typeof import('@mediapipe/tasks-vision')> {
    this.module ??= await import('@mediapipe/tasks-vision');
    return this.module;
  }

  private async ensureTask(kind: LandmarkKind): Promise<void> {
    if (this[kind]) return;
    const module = await this.ensureModule();
    const modelAssetBuffer = await loadLandmarkModel(kind);
    const fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };
    const baseOptions = { modelAssetBuffer, delegate: 'CPU' as const };
    if (kind === 'hand') {
      this.hand = await module.HandLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numHands: 2,
      });
    } else if (kind === 'face') {
      this.face = await module.FaceLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numFaces: 2,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });
    } else {
      this.pose = await module.PoseLandmarker.createFromOptions(fileset, {
        baseOptions,
        runningMode: 'VIDEO',
        numPoses: 2,
        outputSegmentationMasks: false,
      });
    }
  }

  async trackClip(request: LandmarkTrackingRequest): Promise<LandmarkSeries> {
    if (this.running) throw new Error('Another landmark tracking job is already running');
    this.running = true;
    this.cancelled = false;
    const store = useLandmarkTrackingStore.getState();
    store.setSummary(request.clipId, { status: 'loading', progress: 0, message: 'Loading landmark models' });
    const originalTime = request.video.currentTime;
    const wasPlaying = !request.video.paused;
    request.video.pause();

    try {
      for (const kind of request.kinds) {
        if (this.cancelled) throw new DOMException('Tracking cancelled', 'AbortError');
        await this.ensureTask(kind);
      }
      const maxFrames = Math.max(2, request.maxFrames ?? 300);
      const frameCount = Math.max(1, Math.min(maxFrames, Math.ceil(request.duration * 8) + 1));
      const sampleInterval = frameCount <= 1 ? request.duration : request.duration / (frameCount - 1);
      const previousTimestampMs = Number.isFinite(this.lastTimestampMs) ? this.lastTimestampMs : 0;
      const timestampBaseMs = Math.max(previousTimestampMs + 1, performance.now());
      const frames: LandmarkFrame[] = [];
      store.setSummary(request.clipId, { status: 'tracking', message: 'Tracking landmarks' });

      for (let index = 0; index < frameCount; index++) {
        if (this.cancelled) throw new DOMException('Tracking cancelled', 'AbortError');
        const localTime = Math.min(request.duration, index * sampleInterval);
        const sourceTime = Math.max(0, request.sourceStart + localTime);
        await waitForSeek(request.video, sourceTime);
        const timestampMs = timestampBaseMs + index * sampleInterval * 1_000;
        this.lastTimestampMs = timestampMs;
        const image = request.video as ImageSource;
        frames.push({
          time: localTime,
          hands: this.hand ? points(this.hand.detectForVideo(image, timestampMs).landmarks) : [],
          faces: this.face ? points(this.face.detectForVideo(image, timestampMs).faceLandmarks) : [],
          poses: this.pose ? points(this.pose.detectForVideo(image, timestampMs).landmarks) : [],
        });
        store.setSummary(request.clipId, { progress: (index + 1) / frameCount, frameCount: index + 1 });
      }

      const series: LandmarkSeries = {
        version: 1,
        clipId: request.clipId,
        sourceId: request.sourceId,
        sampleInterval,
        createdAt: Date.now(),
        frames,
      };
      landmarkRuntime.setSeries(series);
      await saveLandmarkSidecar(series);
      store.setReady(series);
      return series;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      store.setSummary(request.clipId, {
        status: cancelled ? 'idle' : 'error',
        message: cancelled ? 'Tracking cancelled' : error instanceof Error ? error.message : 'Tracking failed',
      });
      if (!cancelled) log.error('Landmark tracking failed', error);
      throw error;
    } finally {
      await waitForSeek(request.video, Math.min(originalTime, request.video.duration || originalTime)).catch(() => undefined);
      if (wasPlaying) void request.video.play().catch(() => undefined);
      this.running = false;
    }
  }

  cancel(): void {
    this.cancelled = true;
  }
}

interface LandmarkServiceHotData { service?: LandmarkTrackingService }
const hotData = import.meta.hot?.data as LandmarkServiceHotData | undefined;
export const landmarkTrackingService = hotData?.service ?? new LandmarkTrackingService();

if (import.meta.hot) {
  import.meta.hot.dispose((data: LandmarkServiceHotData) => { data.service = landmarkTrackingService; });
}
