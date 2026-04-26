// WebGPU Gaussian Splat Renderer
// Renders splat data into GPU textures for compositor integration.
// Uses instanced quad rendering with 2D gaussian evaluation.
// Wave 4: GPU frustum culling + bitonic depth sort for large scenes.
// Wave 5: temporal 4D playback + particle effects integration.

import { Logger } from '../../../services/logger';
import { SplatRenderTargetPool } from './SplatRenderTargetPool';
import { SplatVisibilityPass } from './SplatVisibilityPass';
import { SplatSortPass } from './SplatSortPass';
import { SplatOrderSorter } from './SplatOrderSorter.ts';
import { ParticleCompute } from '../effects/ParticleCompute';
import { EffectorCompute } from '../../native3d/passes/EffectorCompute';
import type { SceneSplatEffectorRuntimeData } from '../../scene/types';
import type { GaussianSplatParticleSettings, GaussianSplatTemporalSettings } from '../types';
import shaderSource from '../shaders/gaussianSplat.wgsl?raw';

const log = Logger.create('GaussianSplatGpuRenderer');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadableSplatData {
  splatCount: number;
  /** Canonical Float32Array: 14 floats per splat
   *  [x,y,z, sx,sy,sz, rw,rx,ry,rz, r,g,b, opacity] */
  data: Float32Array;
}

export interface SplatCameraParams {
  viewMatrix: Float32Array;       // 4x4 column-major
  projectionMatrix: Float32Array; // 4x4 column-major
  viewport: { width: number; height: number };
  fov: number;
  near: number;
  far: number;
}

interface SplatSceneGpuResources {
  splatBuffer: GPUBuffer;
  splatCount: number;
  /** Identity index buffer: [0, 1, 2, ..., splatCount-1] */
  identityIndexBuffer: GPUBuffer;
  /** Bind group for the render pipeline (splatData + identityIndices) */
  bindGroup: GPUBindGroup;
  /** Frame counter for sort frequency throttling */
  framesSinceSort: number;
  /** Cached sorted bind group — reused between sort frames */
  sortedBindGroup: GPUBindGroup | null;
  workerSorter: SplatOrderSorter | null;
  workerSortedBindGroup: GPUBindGroup | null;
  activeWorkerSortedBindGroup: {
    dataBuffer: GPUBuffer;
    orderBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null;
}

interface CameraUniformResource {
  buffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export interface GaussianSplatRenderDebugSnapshot {
  clipId: string;
  sceneSplatCount: number;
  activeSplatCount: number;
  effectiveSplatCount: number;
  drawCount: number;
  viewport: { width: number; height: number };
  backgroundColor?: string;
  usedCull: boolean;
  usedSort: boolean;
}

export interface GaussianSplatRenderTargetSummary {
  width: number;
  height: number;
  centerPixel: [number, number, number, number];
  nonTransparentSampled: number;
  nonBlackSampled: number;
}

/** Optional parameters for temporal + particle pipeline steps */
export interface SplatRenderOptions {
  /** Clip-local time in seconds (for particle effects) */
  clipLocalTime?: number;
  /** Clear color for the render target. Use "transparent" to preserve alpha. */
  backgroundColor?: string;
  /** Render into an existing color attachment instead of an internal pooled target. */
  outputView?: GPUTextureView;
  /** Color load operation for the target render pass. */
  colorLoadOp?: GPULoadOp;
  /** Optional shared scene depth attachment. */
  depthView?: GPUTextureView;
  /** Whether splat fragments should update the shared depth attachment. */
  depthWrite?: boolean;
  /** Whether the splat pass writes color; false is used for depth-mask-only passes. */
  colorWrite?: boolean;
  /** Depth load operation for the render pass. */
  depthLoadOp?: GPULoadOp;
  /** Depth store operation for the render pass. */
  depthStoreOp?: GPUStoreOp;
  /** Depth clear value used when depthLoadOp is 'clear'. */
  depthClearValue?: number;
  /** Optional per-layer world transform for shared-scene rendering. */
  worldMatrix?: Float32Array;
  /** Layer opacity multiplier applied before premultiplied-alpha output. */
  layerOpacity?: number;
  /** Fragment alpha cutoff for depth-mask passes. Color passes should leave this at the default. */
  depthAlphaCutoff?: number;
  /** Object-level 3D effectors in shared scene space. */
  effectors?: SceneSplatEffectorRuntimeData[];
  /** Max splat budget (0 = unlimited) */
  maxSplats?: number;
  /** Particle effect settings */
  particleSettings?: GaussianSplatParticleSettings;
  /** Sort every N frames (1 = every frame, 0 = never) */
  sortFrequency?: number;
  /** Temporal playback settings (informational — frame switching handled externally via uploadScene) */
  temporalSettings?: GaussianSplatTemporalSettings;
  /** Prefer correctness over throughput (used for offline export). */
  precise?: boolean;
}

// Camera uniform buffer size:
//   view mat4x4f (64)
//   projection mat4x4f (64)
//   viewport vec2f (8)
//   pad vec2f (8)
//   world mat4x4f (64)
//   layer vec4f (16) - x = opacity, y = fragment alpha cutoff
// = 224 bytes
const CAMERA_UNIFORM_SIZE = 224;
const SPLAT_DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

// Floats per splat in the canonical layout
const FLOATS_PER_SPLAT = 14;
const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

// ── Performance thresholds ────────────────────────────────────────────────────
/** Only run frustum culling for scenes above this count */
const CULL_THRESHOLD = 50000;
/** Only run depth sorting for scenes above this count */
const SORT_THRESHOLD = 50000;

// ── Renderer Class ────────────────────────────────────────────────────────────

export class GaussianSplatGpuRenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private pipelineWithDepth: GPURenderPipeline | null = null;
  private pipelineWithDepthWrite: GPURenderPipeline | null = null;
  private pipelineWithDepthWriteMask: GPURenderPipeline | null = null;
  private sceneCache: Map<string, SplatSceneGpuResources> = new Map();
  private cameraUniformPool: CameraUniformResource[] = [];
  private cameraUniformCursor = 0;
  private renderTargetPool!: SplatRenderTargetPool;
  private _initialized = false;

  // Bind group layouts (shared across scenes)
  private splatDataBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroupLayout: GPUBindGroupLayout | null = null;

  // Wave 5: Particle compute subsystem
  private effectorCompute: EffectorCompute = new EffectorCompute();
  private particleCompute: ParticleCompute = new ParticleCompute();
  /** Per-clip effector output buffers (keyed by clipId) */
  private effectorOutputBuffers: Map<string, { buffer: GPUBuffer; splatCount: number }> = new Map();
  /** Per-clip particle output buffers (keyed by clipId) */
  private particleOutputBuffers: Map<string, { buffer: GPUBuffer; splatCount: number }> = new Map();
  // Wave 4: GPU sort + cull passes
  private visibilityPass = new SplatVisibilityPass();
  private sortPass = new SplatSortPass();
  /** Last known visible count from async readback (used as draw count estimate) */
  private lastVisibleCount: Map<string, number> = new Map();
  private lastRenderDebug: Map<string, GaussianSplatRenderDebugSnapshot> = new Map();
  private lastRenderTargets: Map<string, { texture: GPUTexture; width: number; height: number }> = new Map();
  /** One-time debug logging per clip for smoke-test diagnosis */
  private renderDebugLoggedClips: Set<string> = new Set();

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice): void {
    if (this._initialized) {
      // If re-initializing with a different device, dispose old resources
      if (this.device !== device) {
        log.info('Device changed, re-initializing');
        this.disposeGpuResources();
      } else {
        return;
      }
    }

    this.device = device;

    try {
      this.createPipeline();
      this.createCameraBuffer();
      this.renderTargetPool = new SplatRenderTargetPool(device);
      // Wave 4: Initialize sort + cull passes
      this.visibilityPass.initialize(device);
      // Sort pass is initialized lazily per-scene (needs maxSplatCount)

      this.effectorCompute.initialize(device);
      // Wave 5: Initialize particle compute subsystem
      this.particleCompute.initialize(device);
      this._initialized = true;
      log.info('GaussianSplatGpuRenderer initialized (with sort+cull)');
    } catch (err) {
      log.error('Failed to initialize GaussianSplatGpuRenderer', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /** Upload splat data for a clip. Called once per clip (or on temporal frame change). */
  uploadScene(clipId: string, data: UploadableSplatData): boolean {
    if (!this._initialized || !this.device) {
      log.warn('Cannot upload scene: renderer not initialized');
      return false;
    }

    if (data.splatCount <= 0 || data.data.length < data.splatCount * FLOATS_PER_SPLAT) {
      log.warn('Invalid splat data', {
        clipId,
        splatCount: data.splatCount,
        dataLength: data.data.length,
        expected: data.splatCount * FLOATS_PER_SPLAT,
      });
      return false;
    }

    try {
      // Release existing scene for this clip
      this.releaseScene(clipId);

      const bufferSize = data.splatCount * FLOATS_PER_SPLAT * 4; // 4 bytes per float

      const splatBuffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        label: `splat-data-${clipId}`,
      });

      // Write the raw ArrayBuffer to the GPU (avoids TS 5.9 Float32Array<ArrayBufferLike> compat issue)
      const byteOffset = data.data.byteOffset;
      const byteLength = data.splatCount * FLOATS_PER_SPLAT * 4;
      this.device.queue.writeBuffer(splatBuffer, 0, data.data.buffer, byteOffset, byteLength);

      // Create identity index buffer: [0, 1, 2, ..., splatCount-1]
      const identityIndexBuffer = this.createIdentityIndexBuffer(this.device, data.splatCount, clipId);

      const bindGroup = this.device.createBindGroup({
        layout: this.splatDataBindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: splatBuffer } },
          { binding: 1, resource: { buffer: identityIndexBuffer } },
        ],
        label: `splat-bind-group-${clipId}`,
      });

      let workerSorter: SplatOrderSorter | null = null;
      let workerSortedBindGroup: GPUBindGroup | null = null;
      try {
        workerSorter = new SplatOrderSorter(this.device, clipId, data.data, data.splatCount);
        workerSortedBindGroup = this.device.createBindGroup({
          layout: this.splatDataBindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: splatBuffer } },
            { binding: 1, resource: { buffer: workerSorter.orderBuffer } },
          ],
          label: `splat-worker-sorted-bind-group-${clipId}`,
        });
      } catch (sorterError) {
        log.warn('Worker sorter unavailable; realtime splats will use GPU/identity ordering', {
          clipId,
          error: sorterError instanceof Error ? sorterError.message : String(sorterError),
        });
      }

      this.sceneCache.set(clipId, {
        splatBuffer,
        splatCount: data.splatCount,
        identityIndexBuffer,
        bindGroup,
        framesSinceSort: 0,
        sortedBindGroup: null,
        workerSorter,
        workerSortedBindGroup,
        activeWorkerSortedBindGroup: null,
      });

      // Initialize sort pass for this scene's capacity (lazy init)
      if (data.splatCount > SORT_THRESHOLD) {
        this.sortPass.initialize(this.device, data.splatCount);
      }

      log.debug('Uploaded scene', { clipId, splatCount: data.splatCount, bufferSize });
      return true;
    } catch (err) {
      log.error('Failed to upload scene', { clipId, error: err });
      return false;
    }
  }

  /** Release GPU resources for a clip */
  releaseScene(clipId: string): void {
    const scene = this.sceneCache.get(clipId);
    if (scene) {
      scene.splatBuffer.destroy();
      scene.identityIndexBuffer.destroy();
      scene.workerSorter?.destroy();
      this.sceneCache.delete(clipId);
      this.lastVisibleCount.delete(clipId);
      this.releaseEffectorBuffer(clipId);
      // Also clean up particle buffers for this clip
      this.releaseParticleBuffer(clipId);
      log.debug('Released scene', { clipId });
    }
  }

  /**
   * Render one splat layer into a GPU texture. Returns textureView or null.
   *
   * Pipeline order:
   *   1. Temporal sampling — frame switching handled externally via uploadScene()
   *   2. Particle offsets (compute pass, if enabled) [Wave 5]
   *   3. Frustum culling (compute, if splatCount > CULL_THRESHOLD) [Wave 4]
   *   4. Depth sort (compute, if splatCount > SORT_THRESHOLD) [Wave 4]
   *   5. Rasterize (instanced quad rendering with sorted index indirection)
   *
   * @param options - Optional render/temporal/particle settings from layer source
   */
  renderToTexture(
    clipId: string,
    camera: SplatCameraParams,
    viewport: { width: number; height: number },
    commandEncoder: GPUCommandEncoder,
    options?: SplatRenderOptions,
  ): GPUTextureView | null {
    if (!this._initialized || !this.device || !this.pipeline) {
      return null;
    }

    const scene = this.sceneCache.get(clipId);
    if (!scene) {
      log.debug('No scene uploaded for clip', { clipId });
      return null;
    }

    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }

    try {
      // Update camera uniforms
      const worldMatrix = options?.worldMatrix ?? IDENTITY_MATRIX;
      const layerOpacity = clamp01(options?.layerOpacity ?? 1);
      const depthAlphaCutoff = clamp01(options?.depthAlphaCutoff ?? 0);
      const cameraBindGroup = this.writeCameraUniforms(camera, worldMatrix, layerOpacity, depthAlphaCutoff);
      if (!cameraBindGroup) {
        return null;
      }

      const maxSplats = options?.maxSplats ?? 0;
      const sortFrequency = options?.sortFrequency ?? 1;
      const clearColor = parseClearColor(options?.backgroundColor);
      const precise = options?.precise === true;

      // Determine which splat data buffer to use (may be overridden by particle pass)
      let activeSplatBuffer = scene.splatBuffer;
      let activeSplatCount = scene.splatCount;
      const effectors = options?.effectors ?? [];

      if (effectors.length > 0 && this.effectorCompute.isInitialized) {
        const localEffectors = this.effectorCompute.prepareLocalSplatEffectors(worldMatrix, effectors);
        if (localEffectors.length > 0) {
          const effectorOutput = this.getOrCreateEffectorBuffer(clipId, scene.splatCount);
          if (effectorOutput) {
            this.effectorCompute.execute(
              this.device,
              commandEncoder,
              activeSplatBuffer,
              effectorOutput.buffer,
              scene.splatCount,
              localEffectors,
            );
            activeSplatBuffer = effectorOutput.buffer;
            activeSplatCount = scene.splatCount;
          }
        }
      }

      // ── Step 2: Particle offsets (compute pass) [Wave 5] ──
      const particleSettings = options?.particleSettings;
      const clipLocalTime = options?.clipLocalTime ?? 0;

      if (
        particleSettings?.enabled &&
        particleSettings.effectType !== 'none' &&
        this.particleCompute.isInitialized
      ) {
        const particleOutput = this.getOrCreateParticleBuffer(clipId, scene.splatCount);
        if (particleOutput) {
          this.particleCompute.execute(
            this.device,
            commandEncoder,
            activeSplatBuffer,
            particleOutput.buffer,
            scene.splatCount,
            clipLocalTime,
            particleSettings,
          );
          activeSplatBuffer = particleOutput.buffer;
          activeSplatCount = scene.splatCount;
        }
      }

      // Determine effective splat count (respect maxSplats budget)
      const effectiveSplatCount = maxSplats > 0
        ? Math.min(activeSplatCount, maxSplats)
        : activeSplatCount;

      // ── Step 3: Frustum Culling [Wave 4] ──────────────────────────────────
      let cullIndexBuffer: GPUBuffer | null = null;
      let drawCount = effectiveSplatCount;
      let hasValidatedCullResult = false;
      const canUseWorkerSort = !precise &&
        sortFrequency !== 0 &&
        scene.workerSorter !== null &&
        scene.workerSortedBindGroup !== null;
      let usedWorkerSort = false;

      if (canUseWorkerSort && scene.workerSorter) {
        const requestThisFrame = !scene.workerSorter.hasSortedOrder ||
          sortFrequency <= 1 ||
          scene.framesSinceSort + 1 >= sortFrequency;

        if (requestThisFrame) {
          scene.workerSorter.requestSort(camera.viewMatrix, worldMatrix, effectiveSplatCount);
          scene.framesSinceSort = 0;
        } else {
          scene.framesSinceSort++;
        }

        const sortedCount = scene.workerSorter.applyPending(this.device.queue);
        if (sortedCount >= 0) {
          drawCount = Math.min(sortedCount, effectiveSplatCount);
        }
        usedWorkerSort = scene.workerSorter.hasSortedOrder;
      }

      if (
        !canUseWorkerSort &&
        !precise &&
        this.visibilityPass.isInitialized &&
        effectiveSplatCount > CULL_THRESHOLD
      ) {
        const cullResult = this.visibilityPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, effectiveSplatCount,
          camera.viewMatrix, camera.projectionMatrix, worldMatrix,
        );

        if (cullResult) {
          const validatedVisibleCount = this.lastVisibleCount.get(clipId);
          if (validatedVisibleCount !== undefined && validatedVisibleCount > 0) {
            cullIndexBuffer = cullResult.visibleIndexBuffer;
            drawCount = Math.min(validatedVisibleCount, effectiveSplatCount);
            hasValidatedCullResult = true;
          }

          // Kick off async readback for next frame's draw count using a dedicated
          // staging buffer so multiple active clips do not race on shared readback state.
          const readbackBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: `splat-visible-count-readback-${clipId}`,
          });
          commandEncoder.copyBufferToBuffer(
            cullResult.counterBuffer, 0,
            readbackBuffer, 0,
            4,
          );
          this.readbackVisibleCount(clipId, readbackBuffer);
        }
      }

      // ── Step 4: Depth Sort (back-to-front) [Wave 4] ──────────────────────
      let sortedIndexBuffer: GPUBuffer | null = null;
      const shouldSort = !canUseWorkerSort && effectiveSplatCount > SORT_THRESHOLD && (precise || hasValidatedCullResult);
      const sortThisFrame = shouldSort && (
        sortFrequency !== 0 && (
          !scene.sortedBindGroup ||
          sortFrequency <= 1 ||
          scene.framesSinceSort + 1 >= sortFrequency
        )
      );

      if (sortThisFrame && this.sortPass.isInitialized) {
        const sourceIndexBuffer = precise
          ? scene.identityIndexBuffer
          : (cullIndexBuffer ?? scene.identityIndexBuffer);
        const sortCount = precise
          ? effectiveSplatCount
          : (hasValidatedCullResult ? drawCount : effectiveSplatCount);

        const sorted = this.sortPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, sourceIndexBuffer, sortCount,
          camera.viewMatrix,
          worldMatrix,
        );

        if (sorted) {
          sortedIndexBuffer = sorted;
          scene.framesSinceSort = 0;
        }
      } else if (shouldSort) {
        scene.framesSinceSort++;
      }

      // ── Step 5: Rasterize ────────────────────────────────────────────────
      let targetTexture: GPUTexture | null = null;
      let targetView = options?.outputView ?? null;
      if (!targetView) {
        const pooledTarget = this.renderTargetPool.acquire(viewport.width, viewport.height);
        targetTexture = pooledTarget.texture;
        targetView = pooledTarget.view;
        this.lastRenderTargets.set(clipId, {
          texture: targetTexture,
          width: viewport.width,
          height: viewport.height,
        });
      } else {
        this.lastRenderTargets.delete(clipId);
      }

      // Determine which bind group to use
      let renderBindGroup = scene.bindGroup; // default: identity indices + original data

      // Build the appropriate bind group based on which passes ran
      if (canUseWorkerSort && scene.workerSorter && scene.workerSortedBindGroup) {
        renderBindGroup = activeSplatBuffer === scene.splatBuffer
          ? scene.workerSortedBindGroup
          : this.getActiveWorkerSortedBindGroup(scene, clipId, activeSplatBuffer, scene.workerSorter.orderBuffer);
      } else if (sortedIndexBuffer || cullIndexBuffer || activeSplatBuffer !== scene.splatBuffer) {
        const indexBuf = sortedIndexBuffer ?? cullIndexBuffer ?? scene.identityIndexBuffer;
        renderBindGroup = this.device.createBindGroup({
          layout: this.splatDataBindGroupLayout!,
          entries: [
            { binding: 0, resource: { buffer: activeSplatBuffer } },
            { binding: 1, resource: { buffer: indexBuf } },
          ],
          label: `splat-active-bind-group-${clipId}`,
        });
        if (sortedIndexBuffer) {
          scene.sortedBindGroup = renderBindGroup;
        }
      } else if (scene.sortedBindGroup && shouldSort && !sortThisFrame) {
        // Reuse last sorted bind group on skip frames
        renderBindGroup = scene.sortedBindGroup;
      }

      // Create render pass
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            clearValue: clearColor,
            loadOp: options?.colorLoadOp ?? 'clear',
            storeOp: 'store',
          },
        ],
        ...(options?.depthView
          ? {
            depthStencilAttachment: {
              view: options.depthView,
              depthClearValue: options.depthClearValue ?? 1,
              depthLoadOp: options.depthLoadOp ?? 'load',
              depthStoreOp: options.depthStoreOp ?? 'store',
            },
          }
          : {}),
        label: `splat-render-pass-${clipId}`,
      });

      passEncoder.setPipeline(this.getRenderPipeline(
        !!options?.depthView,
        options?.depthWrite === true,
        options?.colorWrite !== false,
      ));
      passEncoder.setBindGroup(0, renderBindGroup);
      passEncoder.setBindGroup(1, cameraBindGroup);

      // Instanced draw: 4 vertices per quad, one instance per splat
      if (!this.renderDebugLoggedClips.has(clipId)) {
        log.info('Gaussian debug render', {
          clipId,
          sceneSplatCount: scene.splatCount,
          activeSplatCount,
          effectiveSplatCount,
          drawCount,
          viewport,
          hasParticleOverride: activeSplatBuffer !== scene.splatBuffer,
          usedCull: !!cullIndexBuffer,
          usedSort: usedWorkerSort || !!sortedIndexBuffer,
        });
        this.renderDebugLoggedClips.add(clipId);
      }
      this.lastRenderDebug.set(clipId, {
        clipId,
        sceneSplatCount: scene.splatCount,
        activeSplatCount,
        effectiveSplatCount,
        drawCount,
        viewport,
        backgroundColor: options?.backgroundColor,
        usedCull: !!cullIndexBuffer,
        usedSort: usedWorkerSort || !!sortedIndexBuffer,
      });
      passEncoder.draw(4, drawCount, 0, 0);
      passEncoder.end();

      return targetView;
    } catch (err) {
      log.error('renderToTexture failed', { clipId, error: err });
      return null;
    }
  }

  /** Called at start of each frame to reset per-frame state */
  beginFrame(): void {
    if (this.renderTargetPool) {
      this.renderTargetPool.resetFrame();
    }
    this.cameraUniformCursor = 0;
  }

  hasScene(clipId: string): boolean {
    return this.sceneCache.has(clipId);
  }

  getLastRenderDebug(clipId: string): GaussianSplatRenderDebugSnapshot | null {
    return this.lastRenderDebug.get(clipId) ?? null;
  }

  async readLastRenderTargetSummary(clipId: string): Promise<GaussianSplatRenderTargetSummary | null> {
    if (!this.device) return null;

    const target = this.lastRenderTargets.get(clipId);
    if (!target) return null;

    const { texture, width, height } = target;
    const bytesPerPixel = 4;
    const unalignedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
    const bufferSize = bytesPerRow * height;

    const readbackBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: `splat-render-target-readback-${clipId}`,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture },
      { buffer: readbackBuffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readbackBuffer.getMappedRange());
    const pixels = new Uint8Array(width * height * bytesPerPixel);

    for (let y = 0; y < height; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * unalignedBytesPerRow;
      pixels.set(src.subarray(srcOffset, srcOffset + unalignedBytesPerRow), dstOffset);
    }

    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const centerIndex = (centerY * width + centerX) * bytesPerPixel;
    const centerPixel: [number, number, number, number] = [
      pixels[centerIndex] ?? 0,
      pixels[centerIndex + 1] ?? 0,
      pixels[centerIndex + 2] ?? 0,
      pixels[centerIndex + 3] ?? 0,
    ];

    let nonTransparentSampled = 0;
    let nonBlackSampled = 0;
    const stride = Math.max(1, Math.floor(Math.min(width, height) / 64));
    for (let y = 0; y < height; y += stride) {
      for (let x = 0; x < width; x += stride) {
        const index = (y * width + x) * bytesPerPixel;
        const r = pixels[index] ?? 0;
        const g = pixels[index + 1] ?? 0;
        const b = pixels[index + 2] ?? 0;
        const a = pixels[index + 3] ?? 0;
        if (a > 0) nonTransparentSampled++;
        if (r > 0 || g > 0 || b > 0) nonBlackSampled++;
      }
    }

    readbackBuffer.unmap();
    readbackBuffer.destroy();

    return {
      width,
      height,
      centerPixel,
      nonTransparentSampled,
      nonBlackSampled,
    };
  }

  dispose(): void {
    this.disposeGpuResources();
    this.device = null;
    this._initialized = false;
    log.info('GaussianSplatGpuRenderer disposed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /** Get or create a particle output buffer for a clip (reused across frames) */
  private getOrCreateEffectorBuffer(
    clipId: string,
    splatCount: number,
  ): { buffer: GPUBuffer; splatCount: number } | null {
    if (!this.device) return null;

    const existing = this.effectorOutputBuffers.get(clipId);
    if (existing && existing.splatCount === splatCount) {
      return existing;
    }

    if (existing) {
      existing.buffer.destroy();
    }

    const byteSize = splatCount * FLOATS_PER_SPLAT * 4;
    const buffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: `effector-output-${clipId}`,
    });

    const entry = { buffer, splatCount };
    this.effectorOutputBuffers.set(clipId, entry);
    return entry;
  }

  private getActiveWorkerSortedBindGroup(
    scene: SplatSceneGpuResources,
    clipId: string,
    dataBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
  ): GPUBindGroup {
    const cached = scene.activeWorkerSortedBindGroup;
    if (cached && cached.dataBuffer === dataBuffer && cached.orderBuffer === orderBuffer) {
      return cached.bindGroup;
    }

    const bindGroup = this.device!.createBindGroup({
      layout: this.splatDataBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: dataBuffer } },
        { binding: 1, resource: { buffer: orderBuffer } },
      ],
      label: `splat-worker-sorted-active-bind-group-${clipId}`,
    });
    scene.activeWorkerSortedBindGroup = { dataBuffer, orderBuffer, bindGroup };
    return bindGroup;
  }

  /** Release effector buffer for a specific clip */
  private releaseEffectorBuffer(clipId: string): void {
    const entry = this.effectorOutputBuffers.get(clipId);
    if (entry) {
      entry.buffer.destroy();
      this.effectorOutputBuffers.delete(clipId);
    }
  }

  /** Get or create a particle output buffer for a clip (reused across frames) */
  private getOrCreateParticleBuffer(
    clipId: string,
    splatCount: number,
  ): { buffer: GPUBuffer; splatCount: number } | null {
    if (!this.device) return null;

    const existing = this.particleOutputBuffers.get(clipId);
    if (existing && existing.splatCount === splatCount) {
      return existing;
    }

    // Release old buffer if splat count changed
    if (existing) {
      existing.buffer.destroy();
    }

    const byteSize = splatCount * FLOATS_PER_SPLAT * 4;
    const buffer = this.device.createBuffer({
      size: byteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: `particle-output-${clipId}`,
    });

    const entry = { buffer, splatCount };
    this.particleOutputBuffers.set(clipId, entry);
    return entry;
  }

  /** Release particle buffer for a specific clip */
  private releaseParticleBuffer(clipId: string): void {
    const entry = this.particleOutputBuffers.get(clipId);
    if (entry) {
      entry.buffer.destroy();
      this.particleOutputBuffers.delete(clipId);
    }
  }

  private disposeGpuResources(): void {
    // Release all scenes
    for (const [clipId, scene] of this.sceneCache) {
      scene.splatBuffer.destroy();
      scene.identityIndexBuffer.destroy();
      scene.workerSorter?.destroy();
      log.debug('Disposed scene buffer', { clipId });
    }
    this.sceneCache.clear();
    this.lastVisibleCount.clear();
    this.lastRenderDebug.clear();
    this.lastRenderTargets.clear();
    this.renderDebugLoggedClips.clear();

    for (const [, entry] of this.effectorOutputBuffers) {
      entry.buffer.destroy();
    }
    this.effectorOutputBuffers.clear();

    // Wave 5: Dispose particle output buffers
    for (const [, entry] of this.particleOutputBuffers) {
      entry.buffer.destroy();
    }
    this.particleOutputBuffers.clear();

    this.effectorCompute.dispose();

    // Wave 5: Dispose particle compute subsystem
    this.particleCompute.dispose();

    // Dispose camera uniform pool
    for (const resource of this.cameraUniformPool) {
      resource.buffer.destroy();
    }
    this.cameraUniformPool = [];
    this.cameraUniformCursor = 0;

    // Dispose render target pool
    if (this.renderTargetPool) {
      this.renderTargetPool.dispose();
    }

    // Wave 4: Dispose sort + cull passes
    this.visibilityPass.dispose();
    this.sortPass.dispose();

    // Nullify pipeline and layouts (they don't need explicit destruction)
    this.pipeline = null;
    this.pipelineWithDepth = null;
    this.pipelineWithDepthWrite = null;
    this.pipelineWithDepthWriteMask = null;
    this.splatDataBindGroupLayout = null;
    this.cameraBindGroupLayout = null;
  }

  private createPipeline(): void {
    if (!this.device) return;

    const shaderModule = this.device.createShaderModule({
      code: shaderSource,
      label: 'gaussian-splat-shader',
    });

    // Group 0: splat data storage buffer + sorted index buffer
    this.splatDataBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
      label: 'splat-data-bind-group-layout',
    });

    // Group 1: camera uniforms
    this.cameraBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'splat-camera-bind-group-layout',
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.splatDataBindGroupLayout, this.cameraBindGroupLayout],
      label: 'gaussian-splat-pipeline-layout',
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
      label: 'gaussian-splat-render-pipeline',
    });

    this.pipelineWithDepth = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
      depthStencil: {
        format: SPLAT_DEPTH_FORMAT,
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
      label: 'gaussian-splat-depth-tested-render-pipeline',
    });

    this.pipelineWithDepthWrite = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
      depthStencil: {
        format: SPLAT_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      label: 'gaussian-splat-depth-writing-render-pipeline',
    });

    this.pipelineWithDepthWriteMask = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba8unorm',
            writeMask: 0,
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
      depthStencil: {
        format: SPLAT_DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
      },
      label: 'gaussian-splat-depth-mask-render-pipeline',
    });

    log.debug('Render pipeline created');
  }

  private createCameraBuffer(): void {
    this.cameraUniformPool = [];
    this.cameraUniformCursor = 0;
  }

  private getCameraUniformResource(): CameraUniformResource | null {
    if (!this.device || !this.cameraBindGroupLayout) return null;

    const index = this.cameraUniformCursor++;
    const existing = this.cameraUniformPool[index];
    if (existing) {
      return existing;
    }

    const buffer = this.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: `splat-camera-uniforms-${index}`,
    });
    const bindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer } },
      ],
      label: `splat-camera-bind-group-${index}`,
    });

    const resource = { buffer, bindGroup };
    this.cameraUniformPool[index] = resource;
    return resource;
  }

  private getRenderPipeline(hasDepth: boolean, depthWrite: boolean, colorWrite: boolean): GPURenderPipeline {
    if (!hasDepth) {
      return this.pipeline!;
    }
    if (depthWrite) {
      if (!colorWrite) {
        return this.pipelineWithDepthWriteMask ?? this.pipelineWithDepthWrite ?? this.pipelineWithDepth ?? this.pipeline!;
      }
      return this.pipelineWithDepthWrite ?? this.pipelineWithDepth ?? this.pipeline!;
    }
    return this.pipelineWithDepth ?? this.pipeline!;
  }

  private writeCameraUniforms(
    camera: SplatCameraParams,
    worldMatrix: Float32Array,
    layerOpacity: number,
    depthAlphaCutoff: number,
  ): GPUBindGroup | null {
    if (!this.device) return null;
    const resource = this.getCameraUniformResource();
    if (!resource) return null;

    // Layout:
    //   mat4x4f view (64 bytes)
    //   mat4x4f projection (64 bytes)
    //   vec2f viewport (8 bytes)
    //   vec2f pad (8 bytes)
    //   mat4x4f world (64 bytes)
    //   vec4f layer (16 bytes; x = opacity, y = fragment alpha cutoff)
    const data = new Float32Array(CAMERA_UNIFORM_SIZE / 4);

    // Copy view matrix (16 floats at offset 0)
    data.set(camera.viewMatrix, 0);

    // Copy projection matrix (16 floats at offset 16)
    data.set(camera.projectionMatrix, 16);

    // Viewport (2 floats at offset 32)
    data[32] = camera.viewport.width;
    data[33] = camera.viewport.height;

    // Padding (2 floats at offset 34) — zero-initialized by Float32Array

    // Copy world matrix (16 floats at offset 36)
    data.set(worldMatrix, 36);

    // Layer controls (4 floats at offset 52)
    data[52] = layerOpacity;
    data[53] = depthAlphaCutoff;

    this.device.queue.writeBuffer(resource.buffer, 0, data);
    return resource.bindGroup;
  }

  /**
   * Create an identity index buffer: [0, 1, 2, ..., count-1]
   * Used as the default (unsorted) index indirection.
   */
  private createIdentityIndexBuffer(device: GPUDevice, count: number, clipId: string): GPUBuffer {
    const identityData = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      identityData[i] = i;
    }

    const buffer = device.createBuffer({
      size: count * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
      label: `splat-identity-indices-${clipId}`,
    });

    new Uint32Array(buffer.getMappedRange()).set(identityData);
    buffer.unmap();

    return buffer;
  }

  /**
   * Asynchronously read back the visible splat count from the cull pass.
   * Updates lastVisibleCount for the next frame's draw call.
   */
  private readbackVisibleCount(clipId: string, readbackBuffer: GPUBuffer): void {
    if (!this.device) {
      readbackBuffer.destroy();
      return;
    }

    this.device.queue.onSubmittedWorkDone()
      .then(() => readbackBuffer.mapAsync(GPUMapMode.READ))
      .then(() => {
        const data = new Uint32Array(readbackBuffer.getMappedRange());
        const count = data[0] ?? 0;
        this.lastVisibleCount.set(clipId, count);
        readbackBuffer.unmap();
        readbackBuffer.destroy();
      })
      .catch((err) => {
        readbackBuffer.destroy();
        log.debug('Visible count readback failed (expected during rapid frame changes)', { clipId, error: err });
      });
  }
}

// ── HMR Singleton ─────────────────────────────────────────────────────────────

let instance: GaussianSplatGpuRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    instance?.dispose();
    data.gaussianSplatGpuRenderer = null;
    instance = null;
  });
}

export function getGaussianSplatGpuRenderer(): GaussianSplatGpuRenderer {
  if (!instance) instance = new GaussianSplatGpuRenderer();
  return instance;
}

export function resetGaussianSplatGpuRenderer(): void {
  instance?.dispose();
  instance = null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function parseClearColor(backgroundColor?: string): GPUColor {
  if (!backgroundColor || backgroundColor === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const normalized = backgroundColor.trim().toLowerCase();
  if (!normalized.startsWith('#')) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const hex = normalized.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    const values = hex.split('').map((char) => parseInt(char + char, 16) / 255);
    return {
      r: values[0] ?? 0,
      g: values[1] ?? 0,
      b: values[2] ?? 0,
      a: values[3] ?? 1,
    };
  }

  if (hex.length === 6 || hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255,
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }

  return { r: 0, g: 0, b: 0, a: 0 };
}
