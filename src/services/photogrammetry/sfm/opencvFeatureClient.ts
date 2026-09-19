import type { CameraPose, FeatureMatch, FrameFeatures, Point2, Point3, PoseEstimate } from './types';

interface FeatureWorkerResponse {
  type: 'result' | 'error' | 'feature-progress';
  requestId?: number;
  data?: unknown;
  message?: string;
  current?: number;
  total?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface RawPoseEstimate {
  rotation: number[];
  translation: number[];
  inlierIndices: number[];
}

export class OpenCvFeatureClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly onFeatureProgress: (current: number, total: number) => void;
  private requestId = 0;
  private terminated = false;

  constructor(onFeatureProgress: (current: number, total: number) => void) {
    this.onFeatureProgress = onFeatureProgress;
    this.worker = new Worker('/workers/opencv-feature.worker.js');
    this.worker.onmessage = (event: MessageEvent<FeatureWorkerResponse>) => {
      const response = event.data;
      if (response.type === 'feature-progress') {
        this.onFeatureProgress(response.current ?? 0, response.total ?? 0);
        return;
      }
      if (response.requestId === undefined) return;
      const pending = this.pending.get(response.requestId);
      if (!pending) return;
      this.pending.delete(response.requestId);
      if (response.type === 'error') pending.reject(new Error(response.message ?? 'OpenCV worker failed.'));
      else pending.resolve(response.data);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'OpenCV feature worker crashed.');
      this.pending.forEach((pending) => pending.reject(error));
      this.pending.clear();
    };
  }

  private call<T>(message: Record<string, unknown>): Promise<T> {
    if (this.terminated) {
      return Promise.reject(new DOMException('Camera solving cancelled.', 'AbortError'));
    }
    const requestId = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.worker.postMessage({ ...message, requestId });
    });
  }

  initialize(files: File[], maxImageSide: number): Promise<Array<FrameFeatures | null>> {
    return this.call({ type: 'initialize', files, maxImageSide });
  }

  match(first: number, second: number): Promise<FeatureMatch[]> {
    return this.call({ type: 'match', first, second, maxDistance: 48, maxMatches: 2_000 });
  }

  async solvePnp(
    objectPoints: Point3[],
    imagePoints: Point2[],
    focal: number,
    principal: Point2,
  ): Promise<PoseEstimate | null> {
    const raw = await this.call<RawPoseEstimate | null>({
      type: 'solve-pnp',
      objectPoints: objectPoints.flatMap((point) => [point.x, point.y, point.z]),
      imagePoints: imagePoints.flatMap((point) => [point.x, point.y]),
      focal,
      principal,
    });
    if (!raw) return null;
    const pose: CameraPose = {
      rotation: raw.rotation as CameraPose['rotation'],
      translation: { x: raw.translation[0], y: raw.translation[1], z: raw.translation[2] },
    };
    return { pose, inlierIndices: raw.inlierIndices };
  }

  async dispose(): Promise<void> {
    if (this.terminated) return;
    try {
      await this.call({ type: 'dispose' });
    } finally {
      this.terminated = true;
      this.worker.terminate();
      this.pending.clear();
    }
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    const error = new DOMException('Camera solving cancelled.', 'AbortError');
    this.pending.forEach((pending) => pending.reject(error));
    this.pending.clear();
  }
}
