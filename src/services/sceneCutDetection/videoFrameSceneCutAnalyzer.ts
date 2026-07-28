import {
  SCENE_CUT_ANALYSIS_HEIGHT,
  SCENE_CUT_ANALYSIS_WIDTH,
  type SceneCutAnalysis,
} from '../../types/sceneCutAnalysis';
import { SceneCutDetector } from './sceneCutDetector';

/**
 * Reads each decoded source frame into a small software 2D canvas. This stays
 * on the main thread deliberately: Linux/Mesa OffscreenCanvas paths can report
 * successful draws while presenting blank pixels.
 */
export class VideoFrameSceneCutAnalyzer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly detector = new SceneCutDetector();
  private frameNumber = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SCENE_CUT_ANALYSIS_WIDTH;
    this.canvas.height = SCENE_CUT_ANALYSIS_HEIGHT;
    const context = this.canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
    if (!context) {
      throw new Error('Could not create the 160x90 scene-cut analysis canvas.');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'low';
    this.context = context;
  }

  analyze(frame: VideoFrame): void {
    this.context.drawImage(
      frame,
      0,
      0,
      SCENE_CUT_ANALYSIS_WIDTH,
      SCENE_CUT_ANALYSIS_HEIGHT,
    );
    const pixels = this.context.getImageData(
      0,
      0,
      SCENE_CUT_ANALYSIS_WIDTH,
      SCENE_CUT_ANALYSIS_HEIGHT,
    );
    this.detector.pushFrame(
      pixels.data,
      frame.timestamp / 1_000_000,
      this.frameNumber,
    );
    this.frameNumber += 1;
  }

  complete(
    duration?: number,
    expectedSourceFrameCount?: number,
    sourceFingerprint?: { size: number; lastModified: number },
  ): SceneCutAnalysis {
    return this.detector.complete(
      duration,
      expectedSourceFrameCount,
      sourceFingerprint,
    );
  }
}
