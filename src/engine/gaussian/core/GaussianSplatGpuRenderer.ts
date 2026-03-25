// WebGPU Gaussian Splat Renderer
// Renders splat data into GPU textures for compositor integration.
// Uses instanced quad rendering with 2D gaussian evaluation.
// Wave 4: GPU frustum culling + bitonic depth sort for large scenes.
// Wave 5: temporal 4D playback + particle effects integration.

import { Logger } from '../../../services/logger';
import { SplatRenderTargetPool } from './SplatRenderTargetPool';
import { SplatVisibilityPass } from './SplatVisibilityPass';
import { SplatSortPass } from './SplatSortPass';
import { ParticleCompute } from '../effects/ParticleCompute';
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
}

/** Optional parameters for temporal + particle pipeline steps */
export interface SplatRenderOptions {
  /** Clip-local time in seconds (for particle effects) */
  clipLocalTime?: number;
  /** Particle effect settings */
  particleSettings?: GaussianSplatParticleSettings;
  /** Temporal playback settings (informational — frame switching handled externally via uploadScene) */
  temporalSettings?: GaussianSplatTemporalSettings;
}

// Camera uniform buffer size: 2 mat4x4f (128 bytes) + vec2f (8 bytes) + vec2f pad (8 bytes) = 144 bytes
const CAMERA_UNIFORM_SIZE = 144;

// Floats per splat in the canonical layout
const FLOATS_PER_SPLAT = 14;

// ── Performance thresholds ────────────────────────────────────────────────────
/** Only run frustum culling for scenes above this count */
const CULL_THRESHOLD = 50000;
/** Only run depth sorting for scenes above this count */
const SORT_THRESHOLD = 1000;

// ── Renderer Class ────────────────────────────────────────────────────────────

export class GaussianSplatGpuRenderer {
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private sceneCache: Map<string, SplatSceneGpuResources> = new Map();
  private cameraUniformBuffer: GPUBuffer | null = null;
  private renderTargetPool!: SplatRenderTargetPool;
  private _initialized = false;

  // Bind group layouts (shared across scenes)
  private splatDataBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroup: GPUBindGroup | null = null;

  // Wave 5: Particle compute subsystem
  private particleCompute: ParticleCompute = new ParticleCompute();
  /** Per-clip particle output buffers (keyed by clipId) */
  private particleOutputBuffers: Map<string, { buffer: GPUBuffer; splatCount: number }> = new Map();
  // Wave 4: GPU sort + cull passes
  private visibilityPass = new SplatVisibilityPass();
  private sortPass = new SplatSortPass();
  /** Last known visible count from async readback (used as draw count estimate) */
  private lastVisibleCount: Map<string, number> = new Map();

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

      this.sceneCache.set(clipId, {
        splatBuffer,
        splatCount: data.splatCount,
        identityIndexBuffer,
        bindGroup,
        framesSinceSort: 0,
        sortedBindGroup: null,
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
      this.sceneCache.delete(clipId);
      this.lastVisibleCount.delete(clipId);
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
   * @param options - Optional temporal/particle settings from layer source
   * @param sortFrequency - Sort every N frames (1 = every frame, 0 = never)
   * @param maxSplats - Max splat budget (0 = unlimited)
   */
  renderToTexture(
    clipId: string,
    camera: SplatCameraParams,
    viewport: { width: number; height: number },
    commandEncoder: GPUCommandEncoder,
    options?: SplatRenderOptions,
    sortFrequency = 1,
    maxSplats = 0,
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
      this.writeCameraUniforms(camera);

      // Determine which splat data buffer to use (may be overridden by particle pass)
      let activeSplatBuffer = scene.splatBuffer;
      let activeSplatCount = scene.splatCount;

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
            scene.splatBuffer,
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

      if (
        this.visibilityPass.isInitialized &&
        effectiveSplatCount > CULL_THRESHOLD
      ) {
        const cullResult = this.visibilityPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, effectiveSplatCount,
          camera.viewMatrix, camera.projectionMatrix,
        );

        if (cullResult) {
          cullIndexBuffer = cullResult.visibleIndexBuffer;
          // Use last known visible count as draw estimate.
          // On the very first frame we use full splatCount (conservative).
          drawCount = this.lastVisibleCount.get(clipId) ?? effectiveSplatCount;

          // Kick off async readback for next frame's draw count
          this.readbackVisibleCount(clipId);
        }
      }

      // ── Step 4: Depth Sort (back-to-front) [Wave 4] ──────────────────────
      let sortedIndexBuffer: GPUBuffer | null = null;
      const shouldSort = effectiveSplatCount > SORT_THRESHOLD;
      const sortThisFrame = shouldSort && (
        sortFrequency <= 1 || scene.framesSinceSort >= sortFrequency
      );

      if (sortThisFrame && this.sortPass.isInitialized) {
        const sourceIndexBuffer = cullIndexBuffer ?? scene.identityIndexBuffer;
        const sortCount = cullIndexBuffer ? drawCount : effectiveSplatCount;

        const sorted = this.sortPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, sourceIndexBuffer, sortCount,
          camera.viewMatrix,
        );

        if (sorted) {
          sortedIndexBuffer = sorted;
          scene.framesSinceSort = 0;
        }
      } else if (shouldSort) {
        scene.framesSinceSort++;
      }

      // ── Step 5: Rasterize ────────────────────────────────────────────────
      const { view: targetView } = this.renderTargetPool.acquire(viewport.width, viewport.height);

      // Determine which bind group to use
      let renderBindGroup = scene.bindGroup; // default: identity indices + original data

      // Build the appropriate bind group based on which passes ran
      if (sortedIndexBuffer || cullIndexBuffer || activeSplatBuffer !== scene.splatBuffer) {
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
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        label: `splat-render-pass-${clipId}`,
      });

      passEncoder.setPipeline(this.pipeline);
      passEncoder.setBindGroup(0, renderBindGroup);
      passEncoder.setBindGroup(1, this.cameraBindGroup!);

      // Instanced draw: 4 vertices per quad, one instance per splat
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
  }

  hasScene(clipId: string): boolean {
    return this.sceneCache.has(clipId);
  }

  dispose(): void {
    this.disposeGpuResources();
    this.device = null;
    this._initialized = false;
    log.info('GaussianSplatGpuRenderer disposed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

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
      log.debug('Disposed scene buffer', { clipId });
    }
    this.sceneCache.clear();
    this.lastVisibleCount.clear();

    // Wave 5: Dispose particle output buffers
    for (const [, entry] of this.particleOutputBuffers) {
      entry.buffer.destroy();
    }
    this.particleOutputBuffers.clear();

    // Wave 5: Dispose particle compute subsystem
    this.particleCompute.dispose();

    // Dispose camera buffer
    if (this.cameraUniformBuffer) {
      this.cameraUniformBuffer.destroy();
      this.cameraUniformBuffer = null;
    }

    // Dispose render target pool
    if (this.renderTargetPool) {
      this.renderTargetPool.dispose();
    }

    // Wave 4: Dispose sort + cull passes
    this.visibilityPass.dispose();
    this.sortPass.dispose();

    // Nullify pipeline and layouts (they don't need explicit destruction)
    this.pipeline = null;
    this.splatDataBindGroupLayout = null;
    this.cameraBindGroupLayout = null;
    this.cameraBindGroup = null;
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
          visibility: GPUShaderStage.VERTEX,
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

    log.debug('Render pipeline created');
  }

  private createCameraBuffer(): void {
    if (!this.device) return;

    this.cameraUniformBuffer = this.device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'splat-camera-uniforms',
    });

    this.cameraBindGroup = this.device.createBindGroup({
      layout: this.cameraBindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer } },
      ],
      label: 'splat-camera-bind-group',
    });
  }

  private writeCameraUniforms(camera: SplatCameraParams): void {
    if (!this.device || !this.cameraUniformBuffer) return;

    // Layout: mat4x4f view (64 bytes) + mat4x4f projection (64 bytes) + vec2f viewport (8 bytes) + vec2f pad (8 bytes)
    const data = new Float32Array(CAMERA_UNIFORM_SIZE / 4);

    // Copy view matrix (16 floats at offset 0)
    data.set(camera.viewMatrix, 0);

    // Copy projection matrix (16 floats at offset 16)
    data.set(camera.projectionMatrix, 16);

    // Viewport (2 floats at offset 32)
    data[32] = camera.viewport.width;
    data[33] = camera.viewport.height;

    // Padding (2 floats at offset 34) — zero-initialized by Float32Array

    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
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
  private readbackVisibleCount(clipId: string): void {
    this.visibilityPass.getVisibleCount().then((count) => {
      if (count > 0) {
        this.lastVisibleCount.set(clipId, count);
      }
    }).catch((err) => {
      log.debug('Visible count readback failed (expected during rapid frame changes)', { clipId, error: err });
    });
  }
}

// ── HMR Singleton ─────────────────────────────────────────────────────────────

let instance: GaussianSplatGpuRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.gaussianSplatGpuRenderer) {
    instance = import.meta.hot.data.gaussianSplatGpuRenderer;
  }
  import.meta.hot.dispose((data) => {
    data.gaussianSplatGpuRenderer = instance;
  });
}

export function getGaussianSplatGpuRenderer(): GaussianSplatGpuRenderer {
  if (!instance) instance = new GaussianSplatGpuRenderer();
  return instance;
}
