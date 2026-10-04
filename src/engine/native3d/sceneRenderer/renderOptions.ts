import type { CompositionRenderSettings, ExportRenderQuality } from '../pathtrace/contracts/ptTypes';

/**
 * Export sampling context of one scene render call. The exporter calls the scene once per sub-sample
 * (raster) or sample batch (path traced) of a frame and encodes only the call that reports the
 * frame complete (see NativeSceneRuntime.getFrameProgress).
 */
export interface NativeSceneExportFrame {
  /** Index of the exported frame; it seeds the deterministic sample sequence. */
  frameIndex: number;
  quality: ExportRenderQuality;
  /** Frame duration in seconds, for the shutter interval. */
  frameDuration: number;
}

/** Per call options of NativeSceneRuntime.renderScene beyond layers and camera. */
export interface NativeSceneRenderOptions {
  /** Composition render settings; absent means raster with defaults. */
  renderSettings?: CompositionRenderSettings;
  /** Set while exporting; absent for preview renders. */
  exportFrame?: NativeSceneExportFrame;
}
