import type { SceneCamera, SceneLightLayer } from '../../../scene/types';
import type { CompositionRenderSettings, PtDebugView, PtStatus } from '../contracts/ptTypes';
import { PT_DEBUG_VIEW_CODE } from '../contracts/ptTypes';
import { PT_LIGHTS_BYTES, PT_MATERIALS_BYTES, PT_FRAME_BYTES } from '../contracts/ptBindings';
import { PtSceneBuilder, type PtMeshInput, type PtPlaneInput, type PtSceneFrame, type PtSphereSetInput, type PtStrandInput, type PtVoxelInput } from '../scene/ptSceneBuilder';
import { PtSceneLimitError } from '../scene/ptPagedBuffer';
import { PtMaterialLimitError } from '../scene/ptSceneMaterials';
import { packPtLights } from '../lights/ptLights';
import { PtEnvironmentCache } from '../lights/ptEnvironment';
import { ptBlueNoiseTexture } from '../integrator/ptBlueNoise';
import { ptPipelines } from './ptPipelines';
import { writePtFrame } from './ptFrameUniforms';
import { publishPtStatus } from './ptStatus';
import { ptLog } from '../ptCompute';
import type { NativeSceneExportFrame } from '../../sceneRenderer/renderOptions';
import { PtDenoiser, type PtDenoiseJob } from '../denoise/ptOidn';
import { reportNativeSceneExportProgress, type NativeSceneExportProgress } from '../../sceneRenderer/sceneExportProgress';
import { PT_BAND_STRIDE, PT_MAX_BANDS, PtDispatchBudget } from './ptDispatchBudget';
import { ptJitter, PtRealtimeRenderer, type PtRealtimeResult } from './ptRealtime';
import { PtPassProfiler } from './ptPassProfiler';

export interface PtRenderRequest {
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  targetKey: string;
  strands: PtStrandInput[];
  meshes: PtMeshInput[];
  planes: PtPlaneInput[];
  voxels: PtVoxelInput[];
  sphereSets: PtSphereSetInput[];
  lights: SceneLightLayer[];
  camera: SceneCamera;
  sceneView: GPUTextureView;
  sceneDepthView: GPUTextureView;
  settings: CompositionRenderSettings;
  exportFrame?: NativeSceneExportFrame;
  /** Timeline playback or scrubbing: fewer samples per frame. */
  realtime: boolean;
  temporaries: GPUBuffer[];
}

interface TargetState {
  width: number;
  height: number;
  accumulation: GPUBuffer;
  auxiliary: GPUBuffer;
  depth: GPUBuffer;
  samples: number;
  signature: string;
  frameIndex: number;
  previousCamera: SceneCamera | null;
  lastFrameMs: number;
  startedAt: number;
  /** OIDN result for `denoisedSignature` over `denoisedSamples`; a running job for the current signature. */
  denoised: GPUBuffer | null;
  denoisedSignature: string;
  denoisedSamples: number;
  denoiseJob: PtDenoiseJob | null;
  /** OIDN is unavailable (initialization failed): the still image fades in from the realtime image instead. */
  denoiseFailed: boolean;
  /** The last frame changed the scene or camera (or the timeline played): the realtime path renders. */
  moving: boolean;
  /** Camera and settings of the last frame (fiber level of detail while the view moves). */
  viewKey: string;
  /** This frame asks for OIDN (export quality or a still preview). */
  wantsDenoise?: boolean;
  /** Realtime frames rendered since the view stopped (the still warm-up). */
  stillRealtimeFrames: number;
}

let debugView: PtDebugView = 'none';
/** Debug view of the path tracer (Albedo, Normal, Depth, BVH heatmap); for the console and the preview overlay. */
export function setPtDebugView(view: PtDebugView): void { debugView = view; }
export function getPtDebugView(): PtDebugView { return debugView; }

/** GPU time per frame the integrator may use: playback and a still preview converging (export renders fixed batches). */
const FRAME_BUDGET_MS = { realtime: 24, still: 30, export: Number.POSITIVE_INFINITY } as const;
/** Most samples one frame adds (the budget decides below that; export always adds this many). */
const MAX_SAMPLES_PER_FRAME = { realtime: 1, still: 8, export: 4 } as const;
/** A converging still image idles this many times as long as its last batch took (a third of the GPU at most). */
const STILL_IDLE_FACTOR = 2;
/** A still image fades from the last realtime image to the accumulation between these sample counts. */
const STILL_FADE_START = 4;
const STILL_FADE_END = 48;
/** A still preview gets a first OIDN pass at this sample count (visible convergence), the final one at the target. */
const EARLY_DENOISE_SAMPLES = 16;
/** Realtime frames rendered beside the accumulation after the view stops (see render()). */
const STILL_REALTIME_FRAMES = 45;
const RESOLVE_UNIFORM_BYTES = 48;
/** Time slices of the shutter interval in a motion blurred export frame (geometry refit per slice). */
const MOTION_BLUR_SLICES = 8;

/** Fraction of the frame interval the shutter is open (lens shutter angle / 360°). */
function shutterFraction(camera: SceneCamera): number {
  return Math.min(1, Math.max(0, (camera.lens?.shutterAngle ?? 0) / 360));
}

/** Shutter time slices of an export frame: as many as fit `samples` in whole batches, at most MOTION_BLUR_SLICES. */
function motionBlurSlices(camera: SceneCamera, samples: number): number {
  if (shutterFraction(camera) <= 0) return 1;
  let slices = MOTION_BLUR_SLICES;
  while (slices > 1 && samples % slices !== 0) slices /= 2;
  return Math.max(1, Math.min(slices, samples));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Path traced branch of NativeSceneRuntime (plan 2.5): builds the GPU scene, accumulates samples
 * while nothing changes (any change of geometry, materials, lights, camera or settings restarts the
 * accumulation), resolves into the scene target and keeps requesting frames until the target
 * sample count is reached. Throws nothing: limits return a visible fallback reason.
 */
export class PathTraceRuntime {
  private readonly builder = new PtSceneBuilder();
  private readonly environment: PtEnvironmentCache;
  private readonly targets = new Map<string, TargetState>();
  private readonly denoiser = new PtDenoiser();
  private frameUniform: GPUBuffer | null = null;
  private realtimeFrameUniform: GPUBuffer | null = null;
  private resolveUniform: GPUBuffer | null = null;
  private lightsBuffer: GPUBuffer | null = null;
  private materialsBuffer: GPUBuffer | null = null;
  private bandBuffer: GPUBuffer | null = null;
  private readonly budget = new PtDispatchBudget();
  private readonly realtimeBudget = new PtDispatchBudget();
  private readonly realtime = new PtRealtimeRenderer();
  private readonly stillProfiler = new PtPassProfiler();
  private realtimePlaceholder: GPUBuffer | null = null;
  private lightsKey = '';
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  /** Requests the next frame after `delayMs` (immediately for 0); a pending request is kept. */
  private requestRenderAfter(delayMs: number): void {
    if (delayMs < 4) { this.requestRender(); return; }
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.requestRender(); }, Math.min(delayMs, 500));
  }

  /** Export accumulation state of this render, reported once its commands are submitted. */
  private pendingExportProgress: Omit<NativeSceneExportProgress, 'gpuDone'> | null = null;
  /** Pixel samples of the last still frame (profiling divides its GPU time by them). */
  lastStillWork = 0;
  private device: GPUDevice | null = null;
  private pending: Array<() => void> = [];

  private readonly requestRender: () => void;

  constructor(requestRender: () => void) {
    this.requestRender = requestRender;
    this.environment = new PtEnvironmentCache(requestRender);
  }

  private ensure(device: GPUDevice): void {
    if (this.device === device) return;
    this.dispose();
    this.device = device;
    const uniform = (label: string, size: number) => device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.frameUniform = uniform('pt-frame', PT_FRAME_BYTES);
    this.realtimeFrameUniform = uniform('pt-frame-realtime', PT_FRAME_BYTES);
    this.resolveUniform = uniform('pt-resolve', RESOLVE_UNIFORM_BYTES);
    this.lightsBuffer = uniform('pt-lights', PT_LIGHTS_BYTES);
    this.materialsBuffer = uniform('pt-materials', PT_MATERIALS_BYTES);
    this.bandBuffer = uniform('pt-bands', PT_BAND_STRIDE * PT_MAX_BANDS);
  }

  private target(device: GPUDevice, key: string, width: number, height: number, temporaries: GPUBuffer[]): TargetState {
    let state = this.targets.get(key);
    if (state && state.width === width && state.height === height) return state;
    if (state) temporaries.push(state.accumulation, state.auxiliary, state.depth);
    const buffer = (label: string, bytes: number) => device.createBuffer({ label: `${label}-${key}`, size: Math.max(16, bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const pixels = width * height;
    state = { width, height, accumulation: buffer('pt-accumulation', pixels * 16), auxiliary: buffer('pt-auxiliary', pixels * 32),
      depth: buffer('pt-pixel-state', pixels * 16), samples: 0, signature: '', frameIndex: 0, previousCamera: null, lastFrameMs: 0,
      startedAt: performance.now(), denoised: null, denoisedSignature: '', denoisedSamples: 0, denoiseJob: null, denoiseFailed: false,
      moving: false, viewKey: '', stillRealtimeFrames: 0 };
    this.targets.set(key, state);
    return state;
  }

  /** Bind groups 0-2 of every scene-reading pass (frame, scene, lights and materials). */
  private sceneGroups(device: GPUDevice, scene: PtSceneFrame, env: { map: GPUTextureView; alias: GPUTextureView }, frameBuffer: GPUBuffer): GPUBindGroup[] {
    const layouts = ptPipelines(device).scene;
    return [
      device.createBindGroup({ layout: layouts.frame, entries: [
        { binding: 0, resource: { buffer: frameBuffer } }, { binding: 1, resource: ptBlueNoiseTexture(device).createView() }] }),
      device.createBindGroup({ layout: layouts.scene, entries: [
        { binding: 0, resource: { buffer: scene.nodePages[0] } }, { binding: 1, resource: { buffer: scene.nodePages[1] } },
        { binding: 2, resource: { buffer: scene.fiberPages[0] } }, { binding: 3, resource: { buffer: scene.fiberPages[1] } },
        { binding: 4, resource: { buffer: scene.objects } }] }),
      device.createBindGroup({ layout: layouts.lightsMaterials, entries: [
        { binding: 0, resource: { buffer: this.lightsBuffer! } }, { binding: 1, resource: { buffer: this.materialsBuffer! } },
        { binding: 2, resource: env.map }, { binding: 3, resource: env.alias }, { binding: 4, resource: scene.atlas },
        { binding: 5, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }] }),
    ];
  }

  /**
   * Encodes one path traced frame into the scene target; false (with the reason in the status) to fall
   * back to raster. While the scene or camera changes (or the timeline plays) the realtime path renders
   * one denoised, upscaled sample per pixel; once everything holds still, samples accumulate without
   * bias at render scale, fading over from the last realtime image, and OIDN polishes the result.
   */
  render(request: PtRenderRequest): boolean {
    const { device, encoder, camera, settings } = request;
    this.ensure(device);
    const exporting = !!request.exportFrame;
    const width = camera.viewport.width, height = camera.viewport.height;
    const scale = exporting ? 1 : settings.renderScale;
    const renderWidth = Math.max(1, Math.round(width * scale)), renderHeight = Math.max(1, Math.round(height * scale));
    const state = this.target(device, request.targetKey, renderWidth, renderHeight, request.temporaries);
    // Fibers thin out while the view moves (preview level of detail). The decision uses only the
    // camera and settings, never the geometry the level itself changes, so when the camera stops
    // one frame restores all fibers and the still image then settles.
    const viewKey = [Array.from(camera.viewMatrix).join(','), Array.from(camera.projectionMatrix).join(','), JSON.stringify(settings)].join('|');
    const viewChanged = viewKey !== state.viewKey;
    state.viewKey = viewKey;
    // Profiled frames (preview performance work) also time the scene build.
    const profileBuild = this.realtime.profiler.begin(device);
    if (profileBuild) this.realtime.profiler.mark(encoder, 'build', false);
    let scene: PtSceneFrame;
    try {
      scene = this.builder.build(device, encoder, { strands: request.strands, meshes: request.meshes, planes: request.planes, voxels: request.voxels,
        sphereSets: request.sphereSets, camera,
        fiberLod: !exporting && (request.realtime || viewChanged) }, request.temporaries, release => this.pending.push(release));
    } catch (error) {
      if (!(error instanceof PtSceneLimitError) && !(error instanceof PtMaterialLimitError)) throw error;
      ptLog.warn('Path tracing falls back to raster', { reason: error.message });
      publishPtStatus(request.targetKey, this.status(state, settings, 'fallback', error.message));
      return false;
    }
    if (profileBuild) this.realtime.profiler.mark(encoder, 'build', true);
    const lights = packPtLights(request.lights, light => this.environment.lookup(device, light));
    const lightsKey = `${Array.from(lights.data.subarray(0, lights.count * 16)).join(',')}|${lights.environmentLayer}`;
    let target = exporting ? request.exportFrame!.quality.samplesPerPixel : settings.stillSamples;
    // An export frame accumulates over its shutter time slices, whose geometry and camera differ: only
    // the frame and its quality restart it. The preview restarts on any change.
    const signature = exporting
      ? [`export:${request.exportFrame!.frameIndex}`, JSON.stringify(request.exportFrame!.quality), JSON.stringify(settings), debugView].join('|')
      : [scene.revision, Array.from(camera.viewMatrix).join(','), Array.from(camera.projectionMatrix).join(','),
        JSON.stringify(camera.lens ?? null), lightsKey, JSON.stringify(settings), debugView, 'preview',
        request.planes.map(plane => plane.version).join(',')].join('|');
    const changed = signature !== state.signature;
    if (changed) {
      state.signature = signature;
      state.samples = 0;
      state.startedAt = performance.now();
      this.dropDenoise(state);
      // A new image measures its own cost: the last one may have been far cheaper (empty frames).
      this.budget.reset();
    }
    device.queue.writeBuffer(this.lightsBuffer!, 0, lights.data);
    device.queue.writeBuffer(this.materialsBuffer!, 0, scene.materials);
    const env = this.environment.textures(device, lights.environmentLayer);
    const frameValues = { camera, previousCamera: state.previousCamera, outputSize: { width, height }, shutter: [0, 0] as [number, number],
      maxBounces: settings.maxBounces, lightCount: lights.count, nodePage1Start: scene.nodePage1Start, fiberPage1Start: scene.fiberPage1Start,
      tlasRoot: scene.tlasRoot, instanceCount: scene.instanceCount, debugView: PT_DEBUG_VIEW_CODE[debugView], seed: 0,
      environmentIndex: lights.environmentIndex, environmentSize: [1, 1] as [number, number], clampIndirect: settings.clampIndirect };
    const stats = { targetSamples: target, segments: scene.stats.segments, bvhNodes: scene.stats.bvhNodes,
      gpuBytes: scene.stats.gpuBytes + this.realtime.gpuBytes };

    // One realtime frame: own frame uniform, so it can share a command buffer with the accumulation.
    const encodeRealtime = () => {
      const tick = this.realtime.tick, jitter = ptJitter(tick);
      const plan = this.realtimeBudget.plan(renderWidth, renderHeight, 1, FRAME_BUDGET_MS.realtime, 1);
      device.queue.writeBuffer(this.realtimeFrameUniform!, 0, writePtFrame({ ...frameValues, renderSize: { width: renderWidth, height: renderHeight },
        jitter, frameIndex: tick, sampleOffset: tick, samples: 1, mode: 0, region: [0, 0, 1, 1] }));
      const clearCache = lightsKey !== this.lightsKey;
      this.lightsKey = lightsKey;
      return this.realtime.encode({ device, encoder, targetKey: request.targetKey, renderSize: { width: renderWidth, height: renderHeight },
        outputSize: { width, height }, sceneGroups: this.sceneGroups(device, scene, env, this.realtimeFrameUniform!), bands: plan.bands, jitter,
        clearCache, budget: this.realtimeBudget, temporaries: request.temporaries });
    };

    state.moving = !exporting && debugView === 'none' && (request.realtime || changed);
    if (state.moving) {
      state.stillRealtimeFrames = 0;
      const output = encodeRealtime();
      state.previousCamera = camera;
      this.resolve(device, encoder, state, request, { output, blend: 1, only: true });
      // One more frame after the motion stops starts the still accumulation.
      this.requestRender();
      publishPtStatus(request.targetKey, { ...this.status(state, settings, 'realtime'), ...stats,
        nsPerSample: this.realtimeBudget.hasMeasurement ? this.realtimeBudget.costNs : 0 });
      return true;
    }

    // Export time limit per frame: whatever has accumulated when it runs out is the frame.
    const timeLimit = exporting ? request.exportFrame!.quality.timeLimitSeconds : 0;
    if (timeLimit > 0 && state.samples > 0 && (performance.now() - state.startedAt) / 1000 >= timeLimit) target = Math.min(target, state.samples);
    const pace = exporting ? 'export' : request.realtime ? 'realtime' : 'still';
    const region = settings.region && !exporting ? [settings.region.x, settings.region.y, settings.region.x + settings.region.width,
      settings.region.y + settings.region.height] as [number, number, number, number] : [0, 0, 1, 1] as [number, number, number, number];
    const x0 = Math.floor(region[0] * renderWidth), y0 = Math.floor(region[1] * renderHeight);
    const regionWidth = Math.max(1, Math.floor(region[2] * renderWidth) - x0);
    const regionRows = Math.max(1, Math.floor(region[3] * renderHeight) - y0);
    // Export renders a fixed number of samples per call: each pixel's sum then groups its samples the
    // same way in every run (bit-identical frames); only the band split follows the measured cost.
    // Motion blur (export): the shutter interval is split into time slices; a render never crosses a slice.
    const slices = exporting ? motionBlurSlices(camera, target) : 1;
    const sliceSamples = target / slices;
    const sliceEnd = Math.min(target, (Math.floor(state.samples / sliceSamples) + 1) * sliceSamples);
    const plan = state.samples >= target ? null
      : this.budget.plan(regionWidth, regionRows, Math.round(sliceEnd - state.samples), FRAME_BUDGET_MS[pace], MAX_SAMPLES_PER_FRAME[pace]);
    const samples = plan?.samples ?? 0;
    if (plan && samples > 0) {
      device.queue.writeBuffer(this.frameUniform!, 0, writePtFrame({ ...frameValues, renderSize: { width: renderWidth, height: renderHeight },
        jitter: [0, 0], frameIndex: state.frameIndex, sampleOffset: state.samples, samples, mode: exporting ? 2 : 1, region,
        adaptiveThreshold: exporting ? request.exportFrame!.quality.adaptiveThreshold : 0 }));
      const pipelines = ptPipelines(device);
      const groups = [...this.sceneGroups(device, scene, env, this.frameUniform!),
        device.createBindGroup({ layout: pipelines.integratorOutputs, entries: [
          { binding: 0, resource: { buffer: state.accumulation } }, { binding: 1, resource: { buffer: state.auxiliary } },
          { binding: 2, resource: { buffer: state.depth } }, { binding: 3, resource: { buffer: this.bandBuffer!, size: 16 } }] })];
      const bandData = new Uint32Array(plan.bands.length * PT_BAND_STRIDE / 4);
      plan.bands.forEach((band, index) => bandData.set([band.firstRow, band.rows], index * PT_BAND_STRIDE / 4));
      device.queue.writeBuffer(this.bandBuffer!, 0, bandData);
      // One pass per band: every pass ends a short GPU workload (see ptDispatchBudget.ts).
      const profiling = this.stillProfiler.begin(device);
      plan.bands.forEach((band, index) => {
        const timestampWrites = profiling ? this.stillProfiler.writes('integrate', index === 0, index === plan.bands.length - 1)
          : this.budget.timestampWrites(device, index, plan.bands.length);
        const pass = encoder.beginComputePass({ label: 'pt-integrate', ...(timestampWrites ? { timestampWrites } : {}) });
        pass.setPipeline(pipelines.integrator);
        groups.forEach((group, slot) => pass.setBindGroup(slot, group, slot === 3 ? [index * PT_BAND_STRIDE] : []));
        pass.dispatchWorkgroups(Math.ceil(regionWidth / 8), Math.ceil(band.rows / 8));
        pass.end();
      });
      if (profiling) this.stillProfiler.resolve(encoder);
      else this.budget.encodeResolve(device, encoder, regionWidth * regionRows * samples);
      this.lastStillWork = regionWidth * regionRows * samples;
      state.samples += samples;
      state.frameIndex++;
    }
    // The first still frames keep the realtime path running beside the accumulation: with a static
    // camera its temporal history settles to a clean image within about a second, which stays on
    // screen until the first OIDN image of the unbiased accumulation replaces it.
    const warming = !exporting && debugView === 'none' && !request.realtime && state.stillRealtimeFrames < STILL_REALTIME_FRAMES
      && !(state.denoised && state.denoisedSignature === state.signature);
    const warmOutput = warming ? encodeRealtime() : null;
    if (warming) state.stillRealtimeFrames++;
    state.previousCamera = camera;
    const converged = state.samples >= target;
    const denoise = (exporting ? request.exportFrame!.quality.denoise : !request.realtime) && debugView === 'none';
    state.wantsDenoise = denoise;
    // Denoise checkpoints: the target, and for the preview an early pass once a few samples exist.
    const checkpoint = converged ? target : !exporting && state.samples >= Math.min(EARLY_DENOISE_SAMPLES, target) ? EARLY_DENOISE_SAMPLES : 0;
    if (denoise && !state.denoiseFailed && checkpoint > 0 && state.denoisedSamples < checkpoint && !state.denoiseJob) {
      this.startDenoise(device, state, exporting ? 'standard' : 'small');
    }
    if (profileBuild && !warmOutput) this.realtime.profiler.resolve(encoder);
    const output = exporting ? null : warmOutput ?? this.realtime.lastOutput(request.targetKey);
    const outputSize = this.realtime.outputSize(request.targetKey);
    const sameSize = !!outputSize && outputSize.width === width && outputSize.height === height;
    const fadeEnd = Math.max(STILL_FADE_START + 8, Math.min(STILL_FADE_END, target));
    const denoised = !!state.denoised && state.denoisedSignature === state.signature;
    // Until the first denoised image exists the last realtime image stays (it is cleaner than a few
    // samples); without a denoiser the accumulation fades in over it.
    const waitForDenoise = denoise && !state.denoiseFailed;
    const blend = output && sameSize && !denoised && debugView === 'none'
      ? waitForDenoise ? 1 : 1 - smoothstep(STILL_FADE_START, fadeEnd, state.samples) : 0;
    this.resolve(device, encoder, state, request, output && sameSize && debugView === 'none' ? { output, blend, only: false } : null);
    // A converging still image leaves the GPU idle for longer than its last batch took (a third of the GPU
    // at most): refining in the background must not stall video and other tabs on the same GPU.
    if (!converged && !exporting) {
      this.requestRenderAfter(plan ? STILL_IDLE_FACTOR * plan.samples * regionWidth * regionRows * this.budget.costNs / 1e6 : 0);
    }
    const denoising = !!state.denoiseJob || (converged && denoise && !state.denoiseFailed && state.denoisedSamples < target);
    if (exporting) {
      const nextSlice = Math.min(slices - 1, Math.floor(state.samples / sliceSamples));
      this.pendingExportProgress = { frameIndex: request.exportFrame!.frameIndex, samples: state.samples, targetSamples: target,
        denoising, complete: converged && this.isFrameComplete(request.targetKey),
        timeOffset: slices > 1 ? nextSlice / slices * shutterFraction(camera) * request.exportFrame!.frameDuration : 0 };
    }
    publishPtStatus(request.targetKey, { ...this.status(state, settings, converged && denoising ? 'denoising' : converged ? 'converged' : 'converging'), ...stats,
      nsPerSample: this.budget.hasMeasurement ? this.budget.costNs : 0 });
    return true;
  }

  /** True when the frame is complete: sampled to its target and denoised if requested (the exporter encodes it then). */
  isFrameComplete(targetKey = 'main'): boolean {
    const state = this.targets.get(targetKey);
    return !!state && state.samples > 0 && !state.denoiseJob && state.signature.length > 0
      && (!state.wantsDenoise || state.denoiseFailed || (state.denoisedSignature === state.signature && state.denoisedSamples >= state.samples));
  }

  private startDenoise(device: GPUDevice, state: TargetState, model: 'standard' | 'small'): void {
    const signature = state.signature;
    const job = this.denoiser.denoise(device, model, { accumulation: state.accumulation, auxiliary: state.auxiliary, pixelState: state.depth,
      samples: () => state.samples,
      width: state.width, height: state.height });
    state.denoiseJob = job;
    void job.promise.then(buffer => {
      if (state.denoiseJob !== job) { buffer?.destroy(); return; }
      state.denoiseJob = null;
      if (!buffer) { state.denoiseFailed = true; this.requestRender(); return; }
      if (state.signature !== signature) { buffer.destroy(); return; }
      state.denoised?.destroy();
      state.denoised = buffer;
      state.denoisedSignature = signature;
      state.denoisedSamples = job.samples;
      this.requestRender();
    });
  }

  private dropDenoise(state: TargetState): void {
    state.denoiseJob?.abort();
    state.denoiseJob = null;
    state.denoised?.destroy();
    state.denoised = null;
    state.denoisedSignature = '';
    state.denoisedSamples = 0;
  }

  /** Draws the frame into the scene target: the accumulation, optionally blended with (or replaced by) the realtime output. */
  private resolve(device: GPUDevice, encoder: GPUCommandEncoder, state: TargetState, request: PtRenderRequest,
    realtime: { output: PtRealtimeResult; blend: number; only: boolean } | null): void {
    const pipelines = ptPipelines(device), inverse = 1 / Math.max(1, state.samples);
    const denoised = state.denoised && state.denoisedSignature === state.signature ? state.denoised : null;
    const { width, height } = request.camera.viewport;
    device.queue.writeBuffer(this.resolveUniform!, 0, Float32Array.of(state.width, state.height, width, height,
      inverse, denoised ? 1 : inverse, PT_DEBUG_VIEW_CODE[debugView], denoised ? 1 : 0, realtime?.blend ?? 0, realtime?.only ? 1 : 0,
      realtime ? 1 : 0, 0));
    this.realtimePlaceholder ??= device.createBuffer({ label: 'pt-realtime-none', size: 16, usage: GPUBufferUsage.STORAGE });
    const pass = encoder.beginRenderPass({ label: 'pt-resolve',
      colorAttachments: [{ view: request.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: request.sceneDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setPipeline(pipelines.resolve);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipelines.resolveLayout, entries: [
      { binding: 0, resource: { buffer: this.resolveUniform! } }, { binding: 1, resource: { buffer: denoised ?? state.accumulation } },
      { binding: 2, resource: { buffer: state.auxiliary } }, { binding: 3, resource: { buffer: state.depth } },
      { binding: 4, resource: { buffer: state.accumulation } },
      { binding: 5, resource: { buffer: realtime?.output.color ?? this.realtimePlaceholder } },
      { binding: 6, resource: { buffer: realtime?.output.depth ?? this.realtimePlaceholder } }] }));
    pass.draw(3);
    pass.end();
  }

  private status(state: TargetState, settings: CompositionRenderSettings, kind: PtStatus['state'], reason?: string): PtStatus {
    return { engine: 'path-traced', state: kind, samples: state.samples, targetSamples: settings.stillSamples,
      frameMs: performance.now() - state.startedAt, renderSize: { width: state.width, height: state.height },
      ...(reason ? { fallbackReason: reason } : {}), segments: 0, bvhNodes: 0, gpuBytes: 0,
      denoisedSamples: state.denoisedSignature === state.signature ? state.denoisedSamples : 0 };
  }

  /** After the frame's command buffer was submitted: release replaced resources, start readbacks. */
  afterSubmit(device: GPUDevice): void {
    this.builder.afterSubmit();
    this.budget.afterSubmit(device);
    this.realtimeBudget.afterSubmit(device);
    this.realtime.afterSubmit();
    this.stillProfiler.afterSubmit();
    if (this.pendingExportProgress) {
      reportNativeSceneExportProgress({ ...this.pendingExportProgress, gpuDone: device.queue.onSubmittedWorkDone() });
      this.pendingExportProgress = null;
    }
    if (!this.pending.length) return;
    const releases = this.pending;
    this.pending = [];
    void device.queue.onSubmittedWorkDone().then(() => releases.forEach(release => release()));
  }

  releaseTarget(key: string): void {
    const state = this.targets.get(key);
    if (!state) return;
    this.dropDenoise(state);
    state.accumulation.destroy(); state.auxiliary.destroy(); state.depth.destroy();
    this.targets.delete(key);
    this.realtime.releaseTarget(key);
    publishPtStatus(key, null);
  }

  dispose(): void {
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = null; }
    for (const key of [...this.targets.keys()]) this.releaseTarget(key);
    this.builder.dispose();
    this.environment.dispose();
    for (const buffer of [this.frameUniform, this.realtimeFrameUniform, this.resolveUniform, this.lightsBuffer, this.materialsBuffer, this.bandBuffer]) {
      buffer?.destroy();
    }
    this.frameUniform = this.realtimeFrameUniform = this.resolveUniform = this.lightsBuffer = this.materialsBuffer = this.bandBuffer = null;
    this.budget.dispose();
    this.realtimeBudget.dispose();
    this.stillProfiler.dispose();
    this.realtime.dispose();
    this.realtimePlaceholder?.destroy(); this.realtimePlaceholder = null;
    this.lightsKey = '';
    this.pending.forEach(release => release());
    this.pending = [];
    this.device = null;
  }
}
