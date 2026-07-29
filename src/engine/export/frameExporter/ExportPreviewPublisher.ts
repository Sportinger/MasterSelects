import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import {
  canRetainExportPreviewFrame,
  reportExportPreviewFrame,
} from '../../../services/timeline/exportRuntimeReporting';

const log = Logger.create('FrameExporter');

type ExportPreviewFrameAdmission = ReturnType<typeof canRetainExportPreviewFrame>;

type ActiveRunIdProvider = () => string | null;

type SoftAdmissionDenialLogger = (
  stage: string,
  decision: ExportPreviewFrameAdmission
) => void;

export class ExportPreviewPublisher {
  private lastPreviewFramePublishMs = Number.NEGATIVE_INFINITY;
  private bitmapInFlight = false;
  private readonly previewFrameIntervalMs: number;
  private readonly getActiveRunId: ActiveRunIdProvider;
  private readonly logSoftAdmissionDenial: SoftAdmissionDenialLogger;

  constructor(
    previewFrameIntervalMs: number,
    getActiveRunId: ActiveRunIdProvider,
    logSoftAdmissionDenial: SoftAdmissionDenialLogger,
  ) {
    this.previewFrameIntervalMs = previewFrameIntervalMs;
    this.getActiveRunId = getActiveRunId;
    this.logSoftAdmissionDenial = logSoftAdmissionDenial;
  }

  publishFrame(videoFrame: VideoFrame, currentTime: number): void {
    const width = videoFrame.displayWidth || videoFrame.codedWidth;
    const height = videoFrame.displayHeight || videoFrame.codedHeight;
    if (!this.shouldAllocateExportPreviewFrame(width, height, currentTime)) return;

    let previewFrame: VideoFrame;
    try {
      previewFrame = videoFrame.clone();
    } catch (error) {
      log.warn('Could not clone export frame for preview', error);
      return;
    }

    try {
      this.publishBitmapWhenStillExporting(
        createImageBitmap(previewFrame),
        currentTime,
        () => previewFrame.close(),
      );
    } catch (error) {
      previewFrame.close();
      log.warn('Could not publish export preview frame', error);
    }
  }

  publishPixels(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    currentTime: number,
  ): void {
    if (!this.shouldAllocateExportPreviewFrame(width, height, currentTime)) return;

    try {
      const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      this.publishBitmapWhenStillExporting(createImageBitmap(imageData), currentTime);
    } catch (error) {
      log.warn('Could not publish export preview frame', error);
    }
  }

  private shouldPublishExportPreviewFrame(): boolean {
    const now = performance.now();
    if (now - this.lastPreviewFramePublishMs < this.previewFrameIntervalMs) {
      return false;
    }
    this.lastPreviewFramePublishMs = now;
    return true;
  }

  private shouldAllocateExportPreviewFrame(
    width: number,
    height: number,
    currentTime: number
  ): boolean {
    if (this.bitmapInFlight) return false;
    if (!this.shouldPublishExportPreviewFrame()) return false;

    const runId = this.getActiveRunId();
    if (!runId) return false;

    const admission = canRetainExportPreviewFrame({
      runId,
      width,
      height,
      currentTime,
    });
    if (!admission.admitted) {
      this.logSoftAdmissionDenial('preview frame', admission);
      return false;
    }
    return true;
  }

  private publishBitmapWhenStillExporting(
    bitmapPromise: Promise<ImageBitmap>,
    currentTime: number,
    cleanup?: () => void,
  ): void {
    this.bitmapInFlight = true;
    void bitmapPromise
      .then((bitmap) => {
        const timeline = useTimelineStore.getState();
        if (!timeline.isExporting) {
          bitmap.close();
          return;
        }

        const runId = this.getActiveRunId();
        if (runId) {
          reportExportPreviewFrame({
            runId,
            width: bitmap.width,
            height: bitmap.height,
            currentTime,
          });
        }
        timeline.setExportPreviewFrame(bitmap, currentTime);
      })
      .catch((error) => {
        log.warn('Could not publish export preview frame', error);
      })
      .finally(() => {
        this.bitmapInFlight = false;
        cleanup?.();
      });
  }
}
