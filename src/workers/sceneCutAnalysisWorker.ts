import { SceneCutDetector } from '../services/sceneCutDetection/sceneCutDetector';
import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_WIDTH,
  type SceneCutAnalysis,
} from '../types/sceneCutAnalysis';

interface AnalyzeRequest {
  type: 'analyze';
  requestId: number;
  frameNumber: number;
  frame: VideoFrame;
}

interface CompleteRequest {
  type: 'complete';
  duration: number;
  expectedSourceFrameCount: number;
  sourceFingerprint: {
    size: number;
    lastModified: number;
  };
}

type WorkerRequest = AnalyzeRequest | CompleteRequest;

interface AnalyzedResponse {
  type: 'analyzed';
  requestId: number;
}

interface CompleteResponse {
  type: 'complete';
  analysis: SceneCutAnalysis;
}

interface ErrorResponse {
  type: 'error';
  requestId?: number;
  message: string;
}

type WorkerResponse = AnalyzedResponse | CompleteResponse | ErrorResponse;

interface SceneCutWorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const workerScope = self as unknown as SceneCutWorkerScope;
const canvas = new OffscreenCanvas(
  SCENE_CUT_ANALYSIS_WIDTH,
  SCENE_CUT_ANALYSIS_HEIGHT,
);
const context = canvas.getContext('2d', {
  alpha: false,
  willReadFrequently: true,
});
const detector = new SceneCutDetector();

function postError(error: unknown, requestId?: number): void {
  workerScope.postMessage({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : String(error),
  });
}

workerScope.onmessage = (event) => {
  const message = event.data;

  if (message.type === 'complete') {
    try {
      workerScope.postMessage({
        type: 'complete',
        analysis: detector.complete(
          message.duration,
          message.expectedSourceFrameCount,
          message.sourceFingerprint,
        ),
      });
    } catch (error) {
      postError(error);
    }
    return;
  }

  if (!context) {
    try {
      message.frame.close();
    } catch {
      // The transferred frame may already be closed after a worker failure.
    }
    postError('Could not create the scene-cut OffscreenCanvas context.', message.requestId);
    return;
  }

  try {
    context.drawImage(
      message.frame,
      0,
      0,
      SCENE_CUT_ANALYSIS_WIDTH,
      SCENE_CUT_ANALYSIS_HEIGHT,
    );
    const imageData = context.getImageData(
      0,
      0,
      SCENE_CUT_ANALYSIS_WIDTH,
      SCENE_CUT_ANALYSIS_HEIGHT,
    );
    detector.pushFrame(
      imageData.data,
      message.frame.timestamp / 1_000_000,
      message.frameNumber,
    );
    message.frame.close();
    workerScope.postMessage({
      type: 'analyzed',
      requestId: message.requestId,
    });
  } catch (error) {
    try {
      message.frame.close();
    } catch {
      // Ignore close errors after a draw/read failure.
    }
    postError(error, message.requestId);
  }
};

export {};
