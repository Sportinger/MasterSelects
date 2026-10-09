/** Accumulation state of an export frame, reported by the path tracer after each render of it. */
export interface NativeSceneExportProgress {
  frameIndex: number;
  samples: number;
  targetSamples: number;
  denoising: boolean;
  /** The renderer actually plans a denoise pass for this frame. */
  denoiseEnabled?: boolean;
  /** Sampled to the target (or the time limit, or every pixel converged) and denoised if requested. */
  complete: boolean;
  /** Resolves when the GPU finished this render (the exporter waits before the next one). */
  gpuDone?: Promise<unknown>;
  /** Seconds after the frame time the next render should show (motion blur time slices; 0 without). */
  timeOffset: number;
}

let exportProgress: NativeSceneExportProgress | null = null;

export function reportNativeSceneExportProgress(progress: NativeSceneExportProgress): void {
  exportProgress = progress;
}

/** Path traced state of export frame `frameIndex`, or null when no path traced scene rendered it. */
export function getNativeSceneExportProgress(frameIndex: number): NativeSceneExportProgress | null {
  return exportProgress?.frameIndex === frameIndex ? exportProgress : null;
}

export function clearNativeSceneExportProgress(): void {
  exportProgress = null;
}
