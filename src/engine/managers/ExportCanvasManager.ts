// ExportCanvasManager - Extracted from WebGPUEngine
// Owns export canvas lifecycle, export/RAM-preview state flags

import { Logger } from '../../services/logger';

const log = Logger.create('ExportCanvasManager');

export class ExportCanvasManager {
  private exportCanvas: OffscreenCanvas | null = null;
  private exportCanvasContext: GPUCanvasContext | null = null;
  private isExporting = false;
  private isGeneratingRamPreview = false;
  private stackedAlpha = false;
  private exportCanvasCaptureFailed = false;

  // --- State Flags ---

  setExporting(exporting: boolean): void {
    this.isExporting = exporting;
    log.info('Export mode', { enabled: exporting });
  }

  getIsExporting(): boolean {
    return this.isExporting;
  }

  setGeneratingRamPreview(generating: boolean): void {
    this.isGeneratingRamPreview = generating;
  }

  getIsGeneratingRamPreview(): boolean {
    return this.isGeneratingRamPreview;
  }

  /** True when preview canvases should be skipped (exporting or RAM preview) */
  shouldSkipPreviewOutput(): boolean {
    return this.isGeneratingRamPreview || this.isExporting;
  }

  // --- Export Canvas Lifecycle ---

  getExportCanvasContext(): GPUCanvasContext | null {
    return this.exportCanvasContext;
  }

  getExportCanvas(): OffscreenCanvas | null {
    return this.exportCanvas;
  }

  isStackedAlpha(): boolean {
    return this.stackedAlpha;
  }

  /**
   * Initialize export canvas for zero-copy VideoFrame creation.
   * Call this before starting export with the target resolution.
   * When stackedAlpha is true, canvas height is doubled (RGB top + alpha-as-luma bottom).
   */
  initExportCanvas(device: GPUDevice, width: number, height: number, stackedAlpha = false): boolean {
    this.exportCanvasCaptureFailed = false;
    this.stackedAlpha = stackedAlpha;
    const canvasHeight = stackedAlpha ? height * 2 : height;
    this.exportCanvas = new OffscreenCanvas(width, canvasHeight);
    const ctx = this.exportCanvas.getContext('webgpu');
    if (!ctx) {
      log.error('Failed to get WebGPU context from OffscreenCanvas');
      this.exportCanvas = null;
      return false;
    }

    const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({
      device,
      format: preferredFormat,
      alphaMode: 'premultiplied',
    });

    this.exportCanvasContext = ctx;
    log.info('Export canvas initialized', { width, height: canvasHeight, stackedAlpha, format: preferredFormat });
    return true;
  }

  /**
   * Create VideoFrame directly from the export canvas (zero-copy path).
   * Must call render() first to populate the canvas.
   * Snapshot immediately after queue.submit(), before yielding to another task.
   * VideoFrame retains the submitted canvas image; the browser synchronizes GPU
   * access internally. A queue-wide JS wait serializes render and encode, and
   * lets cleanup/reinitialization replace the source before it is captured.
   */
  async createVideoFrameFromExport(_device: GPUDevice, timestamp: number, duration: number): Promise<VideoFrame | null> {
    const canvas = this.exportCanvas;
    if (!canvas) {
      log.error('Export canvas not initialized');
      return null;
    }
    // The caller uses pixel readback after a capture failure. Do not retry an
    // unsupported canvas-to-VideoFrame path on every remaining export frame.
    if (this.exportCanvasCaptureFailed) return null;

    try {
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration,
        alpha: 'discard',
      });
      return frame;
    } catch (e) {
      if (this.exportCanvas === canvas) this.exportCanvasCaptureFailed = true;
      log.error('Failed to create VideoFrame from export canvas', e);
      return null;
    }
  }

  /**
   * Cleanup export canvas after export completes.
   */
  cleanupExportCanvas(): void {
    this.exportCanvasContext = null;
    this.exportCanvas = null;
    this.stackedAlpha = false;
    log.debug('Export canvas cleaned up');
  }

  destroy(): void {
    this.cleanupExportCanvas();
    this.isExporting = false;
    this.isGeneratingRamPreview = false;
  }
}
