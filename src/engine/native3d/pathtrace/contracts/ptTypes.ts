/**
 * Path tracing contract types shared by the raster and path traced renderers, the composition and
 * export settings, the worker projection and the UI. Plain data only: no GPU or DOM handles.
 */

/** Which renderer draws the native 3D scene. */
export type RenderEngine = 'raster' | 'path-traced';
export const RENDER_ENGINES: readonly RenderEngine[] = ['raster', 'path-traced'];

/**
 * View transform applied when the scene enters the compositor. `auto` keeps the legacy clamp for
 * raster scenes and uses AgX for path traced scenes; `standard` is a plain clamp in display space.
 */
export type ToneMapping = 'auto' | 'standard' | 'agx' | 'aces' | 'neutral';
export const TONE_MAPPINGS: readonly ToneMapping[] = ['auto', 'standard', 'agx', 'aces', 'neutral'];
/** Tone mapping after `auto` is resolved for an engine. */
export type ResolvedToneMapping = Exclude<ToneMapping, 'auto'>;
export const TONE_MAPPING_CODE: Record<ResolvedToneMapping, number> = { standard: 0, agx: 1, aces: 2, neutral: 3 };

export function resolveToneMapping(mapping: ToneMapping | undefined, engine: RenderEngine): ResolvedToneMapping {
  if (!mapping || mapping === 'auto') return engine === 'path-traced' ? 'agx' : 'standard';
  return mapping;
}

/** Internal resolution of the realtime path tracer relative to the output. */
export const PT_RENDER_SCALES = [0.5, 0.67, 1] as const;
export type PtRenderScale = typeof PT_RENDER_SCALES[number];

/** Render settings stored on a composition; the export takes them over and may override. */
export interface CompositionRenderSettings {
  engine: RenderEngine;
  /** Realtime path tracing resolution scale in the preview. */
  renderScale: PtRenderScale;
  /** Samples per pixel the paused preview converges to before the final denoise. */
  stillSamples: number;
  /** Path length (bounces after the camera hit). */
  maxBounces: number;
  /** Indirect sample radiance is clamped to this luminance to suppress fireflies (0 = off). */
  clampIndirect: number;
  /** Optional preview render region in normalized output coordinates. */
  region?: PtRegion;
}

export interface PtRegion { x: number; y: number; width: number; height: number }

export const DEFAULT_COMPOSITION_RENDER_SETTINGS: CompositionRenderSettings = {
  engine: 'raster',
  renderScale: 0.5,
  stillSamples: 256,
  maxBounces: 8,
  clampIndirect: 10,
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
};

function normalizeRegion(value: unknown): PtRegion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const region = value as Partial<PtRegion>;
  const x = clampNumber(region.x, 0, 1, 0), y = clampNumber(region.y, 0, 1, 0);
  const width = clampNumber(region.width, 0, 1 - x, 1 - x), height = clampNumber(region.height, 0, 1 - y, 1 - y);
  return width > 0.01 && height > 0.01 ? { x, y, width, height } : undefined;
}

/** Fills defaults and clamps a stored or transported value; unknown keys are dropped. */
export function normalizeCompositionRenderSettings(value: unknown): CompositionRenderSettings {
  const input = value && typeof value === 'object' ? value as Partial<CompositionRenderSettings> : {};
  const scale = PT_RENDER_SCALES.includes(input.renderScale as PtRenderScale) ? input.renderScale as PtRenderScale
    : DEFAULT_COMPOSITION_RENDER_SETTINGS.renderScale;
  const region = normalizeRegion(input.region);
  return {
    engine: input.engine === 'path-traced' ? 'path-traced' : 'raster',
    renderScale: scale,
    stillSamples: Math.round(clampNumber(input.stillSamples, 1, 65536, DEFAULT_COMPOSITION_RENDER_SETTINGS.stillSamples)),
    maxBounces: Math.round(clampNumber(input.maxBounces, 1, 64, DEFAULT_COMPOSITION_RENDER_SETTINGS.maxBounces)),
    clampIndirect: clampNumber(input.clampIndirect, 0, 1e6, DEFAULT_COMPOSITION_RENDER_SETTINGS.clampIndirect),
    ...(region ? { region } : {}),
  };
}

/**
 * Physical camera of a 3D camera clip. `fStop` 0 is a pinhole (no depth of field); `focusDistance`
 * 0 focuses on the camera target; `shutterAngle` 0 disables motion blur (degrees of a frame).
 */
export interface CameraLensSettings {
  exposure: number;
  toneMapping: ToneMapping;
  fStop: number;
  focusDistance: number;
  shutterAngle: number;
}

export const DEFAULT_CAMERA_LENS: CameraLensSettings = {
  exposure: 0,
  toneMapping: 'auto',
  fStop: 0,
  focusDistance: 0,
  shutterAngle: 0,
};

export function normalizeCameraLens(value: unknown): CameraLensSettings {
  const input = value && typeof value === 'object' ? value as Partial<CameraLensSettings> : {};
  return {
    exposure: clampNumber(input.exposure, -16, 16, 0),
    toneMapping: TONE_MAPPINGS.includes(input.toneMapping as ToneMapping) ? input.toneMapping as ToneMapping : 'auto',
    fStop: clampNumber(input.fStop, 0, 64, 0),
    focusDistance: clampNumber(input.focusDistance, 0, 1e5, 0),
    shutterAngle: clampNumber(input.shutterAngle, 0, 360, 0),
  };
}

/** Export override of the composition's engine and its quality per engine. */
export interface ExportRenderQuality {
  /** Undefined takes the composition's engine. */
  engine?: RenderEngine;
  /** Raster: jittered sub-samples per frame (lens, lights and shutter included). */
  rasterSubSamples: number;
  /** Path traced: samples per pixel. */
  samplesPerPixel: number;
  /** Relative error below which a pixel stops sampling (0 = adaptive sampling off). */
  adaptiveThreshold: number;
  /** Seconds per frame after which sampling stops (0 = no limit). Hitting it breaks determinism. */
  timeLimitSeconds: number;
  denoise: boolean;
}

export const DEFAULT_EXPORT_RENDER_QUALITY: ExportRenderQuality = {
  rasterSubSamples: 1,
  samplesPerPixel: 256,
  adaptiveThreshold: 0,
  timeLimitSeconds: 0,
  denoise: true,
};

export function normalizeExportRenderQuality(value: unknown): ExportRenderQuality {
  const input = value && typeof value === 'object' ? value as Partial<ExportRenderQuality> : {};
  const engine = input.engine === 'raster' || input.engine === 'path-traced' ? input.engine : undefined;
  return {
    ...(engine ? { engine } : {}),
    rasterSubSamples: Math.round(clampNumber(input.rasterSubSamples, 1, 256, 1)),
    samplesPerPixel: Math.round(clampNumber(input.samplesPerPixel, 1, 65536, 256)),
    adaptiveThreshold: clampNumber(input.adaptiveThreshold, 0, 1, 0),
    timeLimitSeconds: clampNumber(input.timeLimitSeconds, 0, 3600, 0),
    denoise: input.denoise !== false,
  };
}

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
  state: 'idle' | 'realtime' | 'converging' | 'denoising' | 'converged' | 'fallback';
  samples: number;
  targetSamples: number;
  frameMs: number;
  renderSize: { width: number; height: number };
  /** Visible reason when the scene fell back to raster (device limits, unsupported feature). */
  fallbackReason?: string;
  segments: number;
  bvhNodes: number;
  gpuBytes: number;
}
