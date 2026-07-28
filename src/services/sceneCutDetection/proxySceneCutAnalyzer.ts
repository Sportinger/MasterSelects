import { prefersSoftwareTimelineCanvas } from '../../utils/canvasPlatform';
import type { SceneCutAnalysis } from '../../types/sceneCutAnalysis';
import { SceneCutAnalysisWorkerClient } from './sceneCutAnalysisWorkerClient';
import { VideoFrameSceneCutAnalyzer } from './videoFrameSceneCutAnalyzer';

export type SceneCutAnalysisBackend = 'worker' | 'software-main-thread';

export class ProxySceneCutAnalyzer {
  private readonly workerClient: SceneCutAnalysisWorkerClient | null;
  private readonly softwareAnalyzer: VideoFrameSceneCutAnalyzer | null;
  readonly backend: SceneCutAnalysisBackend;

  constructor() {
    const workerAvailable =
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      !prefersSoftwareTimelineCanvas();

    if (workerAvailable) {
      try {
        this.workerClient = new SceneCutAnalysisWorkerClient();
        this.softwareAnalyzer = null;
        this.backend = 'worker';
        return;
      } catch {
        // Fall through to the reliable main-thread software path.
      }
    }

    this.workerClient = null;
    this.softwareAnalyzer = new VideoFrameSceneCutAnalyzer();
    this.backend = 'software-main-thread';
  }

  analyze(frame: VideoFrame): void {
    if (this.workerClient) {
      this.workerClient.analyze(frame);
      return;
    }
    this.softwareAnalyzer?.analyze(frame);
  }

  waitForBackpressure(): Promise<void> {
    return this.workerClient?.waitForBackpressure() ?? Promise.resolve();
  }

  complete(
    duration: number,
    expectedSourceFrameCount: number,
    sourceFingerprint: { size: number; lastModified: number },
  ): Promise<SceneCutAnalysis> {
    if (this.workerClient) {
      return this.workerClient.complete(
        duration,
        expectedSourceFrameCount,
        sourceFingerprint,
      );
    }
    if (!this.softwareAnalyzer) {
      return Promise.reject(new Error('Scene-cut analyzer is unavailable.'));
    }
    return Promise.resolve(this.softwareAnalyzer.complete(
      duration,
      expectedSourceFrameCount,
      sourceFingerprint,
    ));
  }

  dispose(): void {
    this.workerClient?.dispose();
  }
}
