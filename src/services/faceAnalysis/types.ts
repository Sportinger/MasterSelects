import type {
  FaceAnalysisBackend,
  FaceAnalysisBox,
  FaceAnalysisPoint,
  FaceFrameDetection,
} from '../../types/clipMetadata';

export interface FaceModelLoadProgress {
  progress: number;
  message: string;
}

export interface FaceRuntimeDetection {
  confidence: number;
  box: FaceAnalysisBox;
  landmarks: FaceAnalysisPoint[];
  embedding: Float32Array;
}

export interface TrackedFaceDetection extends FaceFrameDetection {
  embedding?: never;
}

export type FaceWorkerRequest =
  | {
      type: 'initialize';
      yunetBuffer: ArrayBuffer;
      sfaceBuffer: ArrayBuffer;
      preferWebGpu: boolean;
    }
  | {
      type: 'analyze-frame';
      requestId: string;
      rgba: ArrayBuffer;
      width: number;
      height: number;
    }
  | { type: 'dispose' };

export type FaceWorkerResponse =
  | { type: 'ready'; backend: FaceAnalysisBackend }
  | { type: 'result'; requestId: string; detections: FaceRuntimeDetection[] }
  | { type: 'error'; requestId?: string; error: string };
