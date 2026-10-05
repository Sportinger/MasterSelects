/**
 * Path tracing contract types shared by the raster and path traced renderers, the composition and
 * export settings, the worker projection and the UI. Plain data only: no GPU or DOM handles.
 */

export {
  RENDER_ENGINES, TONE_MAPPINGS, TONE_MAPPING_CODE, resolveToneMapping, PT_RENDER_SCALES, DEFAULT_COMPOSITION_RENDER_SETTINGS,
  normalizeCompositionRenderSettings, DEFAULT_CAMERA_LENS, normalizeCameraLens, DEFAULT_EXPORT_RENDER_QUALITY, normalizeExportRenderQuality,
} from '../../../../types/renderSettings';
export type {
  RenderEngine, ToneMapping, ResolvedToneMapping, PtRenderScale, CompositionRenderSettings, PtRegion, CameraLensSettings, ExportRenderQuality,
} from '../../../../types/renderSettings';
import type { CameraLensSettings, CompositionRenderSettings, RenderEngine } from '../../../../types/renderSettings';

/** How a frame is produced: realtime preview, unbiased still convergence or deterministic export. */
export type PtFrameMode = 'preview' | 'still' | 'export';

/** Camera state of one frame, in scene space. Matrices are column-major. */
export interface PtCameraState {
  view: Float32Array;
  projection: Float32Array;
  position: [number, number, number];
  /** Unit vectors of the camera frame (scene space). */
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  projectionKind: 'perspective' | 'orthographic';
  /** Vertical field of view (radians); orthographic: half height of the view volume. */
  fovY: number;
  orthographicHalfHeight: number;
  near: number;
  far: number;
  lens: CameraLensSettings;
  /** Distance used when `lens.focusDistance` is 0. */
  targetDistance: number;
}

/** Everything one path traced frame depends on besides the scene. */
export interface PtFrameInputs {
  mode: PtFrameMode;
  camera: PtCameraState;
  previousCamera: PtCameraState | null;
  /** Output size and the internal render size (render scale applied in preview). */
  outputSize: { width: number; height: number };
  renderSize: { width: number; height: number };
  /** Subpixel jitter in render pixels, [-0.5, 0.5). */
  jitter: [number, number];
  /** Monotonic frame counter of the realtime path; drives blue noise and temporal reuse. */
  frameIndex: number;
  /** First sample index of this dispatch inside the pixel's sample sequence. */
  sampleOffset: number;
  samplesThisFrame: number;
  /** Timeline time (seconds) and the shutter interval sampled around it (seconds, relative). */
  time: number;
  shutterOpen: number;
  shutterClose: number;
  settings: CompositionRenderSettings;
}

/** Per-pixel outputs of the path tracer. */
export type PtAov = 'color' | 'albedo' | 'normal' | 'depth' | 'motion' | 'materialId';
export const PT_AOVS: readonly PtAov[] = ['color', 'albedo', 'normal', 'depth', 'motion', 'materialId'];

/** Debug views of the path tracer (Phase 2). */
export type PtDebugView = 'none' | 'albedo' | 'normal' | 'depth' | 'bvh-heatmap';
export const PT_DEBUG_VIEW_CODE: Record<PtDebugView, number> = { none: 0, albedo: 1, normal: 2, depth: 3, 'bvh-heatmap': 4 };

/** Status of the path tracer as shown by the preview overlay and export progress. */
export interface PtStatus {
  engine: RenderEngine;
  previewBackend?: 'webgpu' | 'optix';
  nativeMessage?: string;
  state: 'idle' | 'realtime' | 'converging' | 'denoising' | 'converged' | 'fallback';
  samples: number;
  /** Fraction of the next preview sample already covered; `samples` counts complete images. */
  partialSample?: number;
  targetSamples: number;
  frameMs: number;
  renderSize: { width: number; height: number };
  /** Visible reason when the scene fell back to raster (device limits, unsupported feature). */
  fallbackReason?: string;
  segments: number;
  bvhNodes: number;
  gpuBytes: number;
  /** Measured GPU nanoseconds per pixel sample (0 before the first measurement). */
  nsPerSample?: number;
  /** Samples behind the denoised image on screen (0: none yet). */
  denoisedSamples?: number;
}
