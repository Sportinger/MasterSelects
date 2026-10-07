import { SplatGraphPass } from '../graph/SplatGraphPass';
import { SplatMeshPass } from '../graph/SplatMeshPass';
import { Logger } from '../../../services/logger';
import { SplatRenderTargetPool } from './SplatRenderTargetPool';
import { SplatVisibilityPass } from './SplatVisibilityPass';
import { SplatSortPass } from './SplatSortPass';
import { ParticleCompute } from '../effects/ParticleCompute';
import { EffectorCompute } from '../../native3d/passes/EffectorCompute';
import { createSplatRenderPipelines, splatPipelinesForFormat } from './splatRenderer/pipelines';
import {
  createSplatCameraUniformResource,
  writeSplatCameraUniforms,
  type SplatCameraParams,
  type SplatCameraUniformResource,
} from './splatRenderer/cameraUniforms';
import {
  getExpectedSplatFloatCount,
  getOrCreateEffectorStorageBuffer,
  getOrCreateParticleStorageBuffer,
  getSplatBufferByteSize,
  isUploadableSplatDataValid,
  releaseEffectorStorageBuffer,
  releaseParticleStorageBuffer,
  type SplatStorageBufferResource,
  type UploadableSplatData,
} from './splatRenderer/sceneUpload';
import {
  buildSplatRenderPassDescriptor,
  CULL_THRESHOLD,
  prepareSplatRenderParams,
  SORT_THRESHOLD,
  type SplatRenderOptions,
} from './splatRenderer/renderParams';
import {
  createSplatSceneResources,
  releaseSplatSceneResources,
  type SplatSceneGpuResources,
} from './splatRenderer/sceneResources';
import { updateGpuSortFrame, updateWorkerSortFrame } from './splatRenderer/sortGlue';
import { resolveSplatDrawBindGroup, SplatDrawStreams } from './splatRenderer/drawStreams';
import {
  readRenderTargetSummary,
  type GaussianSplatRenderTargetSummary,
} from './splatRenderer/renderTargetSummary';
import { resolveSplatRenderTarget } from './splatRenderer/renderTargets';
import { queueSplatVisibleCountReadback } from './splatRenderer/visibleCountReadback';
import {
  recordSplatRenderDebug,
  type GaussianSplatRenderDebugSnapshot,
} from './splatRenderer/debugSnapshots';

const log = Logger.create('GaussianSplatGpuRenderer');

// ── Public contracts (owned by splatRenderer modules, re-exported here) ──────

export type {
  GaussianSplatRenderDebugSnapshot,
  GaussianSplatRenderTargetSummary,
  SplatCameraParams,
  SplatRenderOptions,
  UploadableSplatData,
};

// ── Renderer Class ────────────────────────────────────────────────────────────

export class GaussianSplatGpuRenderer {
  private graphPass = new SplatGraphPass();
  private meshPass = new SplatMeshPass();
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private pipelineWithDepth: GPURenderPipeline | null = null;
  private pipelineWithDepthWrite: GPURenderPipeline | null = null;
  private pipelineWithDepthWriteMask: GPURenderPipeline | null = null;
  private splatDataBindGroupLayout: GPUBindGroupLayout | null = null;
  private cameraBindGroupLayout: GPUBindGroupLayout | null = null;
  private sceneCache: Map<string, SplatSceneGpuResources> = new Map();
  private cameraUniformPool: SplatCameraUniformResource[] = [];
  private cameraUniformCursor = 0;
  private renderTargetPool!: SplatRenderTargetPool;
  private _initialized = false;

  // Wave 5: Particle compute subsystem
  private effectorCompute: EffectorCompute = new EffectorCompute();
  private particleCompute: ParticleCompute = new ParticleCompute();
  /** Per-clip effector output buffers (keyed by clipId) */
  private effectorOutputBuffers: Map<string, SplatStorageBufferResource> = new Map();
  /** Per-clip particle output buffers (keyed by clipId) */
  private particleOutputBuffers: Map<string, SplatStorageBufferResource> = new Map();
  // Wave 4: GPU sort + cull passes
  private visibilityPass = new SplatVisibilityPass();
  private sortPass = new SplatSortPass();
  /** Cull count, GPU sort cadence and own GPU order per scene + graph branch */
  private drawStreams = new SplatDrawStreams();
  private lastRenderDebug: Map<string, GaussianSplatRenderDebugSnapshot> = new Map();
  private lastRenderTargets: Map<string, { texture: GPUTexture; width: number; height: number }> = new Map();
  /** One-time debug logging per clip for smoke-test diagnosis */
  private renderDebugLoggedClips: Set<string> = new Set();

  get isInitialized(): boolean {
    return this._initialized;
  }

  /** Refresh shader-dependent resources while retaining uploaded scenes across HMR. */
  refreshAfterHmr(): void {
    const legacy = this as unknown as { graphCompute?: { dispose(): void }; cropCache?: { dispose(): void } };
    legacy.graphCompute?.dispose(); delete legacy.graphCompute; legacy.cropCache?.dispose(); delete legacy.cropCache;
    this.graphPass?.dispose(); this.graphPass = new SplatGraphPass(); this.meshPass ??= new SplatMeshPass();
    Object.setPrototypeOf(this.meshPass, SplatMeshPass.prototype);
    // These passes keep the prototype and field layout of the module version that built
    // them; rebuild them so hot updates take effect. Their old GPU objects are dropped, not
    // destroyed, because an unsubmitted encoder may still reference them.
    const sortWasInitialized = this.sortPass.isInitialized;
    this.visibilityPass = new SplatVisibilityPass();
    this.sortPass = new SplatSortPass();
    this.drawStreams = new SplatDrawStreams(); // their GPU orders lived in the dropped sort pass
    this.particleCompute = new ParticleCompute();
    this.effectorCompute = new EffectorCompute();
    if (!this._initialized || !this.device) return;

    const staleCameraResources = this.cameraUniformPool;
    this.createPipeline();
    this.createCameraBuffer();
    this.visibilityPass.initialize(this.device);
    if (sortWasInitialized) this.sortPass.initialize(this.device);
    this.effectorCompute.initialize(this.device);
    this.particleCompute.initialize(this.device);
    this.renderDebugLoggedClips.clear();

    void this.device.queue.onSubmittedWorkDone()
      .then(() => {
        for (const resource of staleCameraResources) resource.buffer.destroy();
      })
      .catch(() => {
        for (const resource of staleCameraResources) resource.buffer.destroy();
      });
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
    if (!this._initialized || !this.device || !this.splatDataBindGroupLayout) {
      log.warn('Cannot upload scene: renderer not initialized');
      return false;
    }

    if (!isUploadableSplatDataValid(data)) {
      log.warn('Invalid splat data', {
        clipId,
        splatCount: data.splatCount,
        dataLength: data.data.length,
        expected: getExpectedSplatFloatCount(data.splatCount),
      });
      return false;
    }

    try {
      // Release existing scene for this clip
      this.releaseScene(clipId);

      const scene = createSplatSceneResources(
        this.device,
        this.splatDataBindGroupLayout,
        clipId,
        data,
        log,
      );
      this.sceneCache.set(clipId, scene);
      this.meshPass.upload(clipId, data.data, data.splatCount);

      // Initialize sort pass for this scene's capacity (lazy init)
      if (data.splatCount > SORT_THRESHOLD) {
        this.sortPass.initialize(this.device, data.splatCount);
      }

      log.debug('Uploaded scene', {
        clipId,
        splatCount: data.splatCount,
        bufferSize: getSplatBufferByteSize(data.splatCount),
      });
      return true;
    } catch (err) {
      log.error('Failed to upload scene', { clipId, error: err });
      return false;
    }
  }

  /** Release GPU resources for a clip */
  releaseScene(clipId: string): void {
    this.graphPass.release(clipId);
    this.meshPass.release(clipId);
    // Sorted-index buffers are retired, not destroyed: a recorded pass may still use them.
    this.drawStreams.release(clipId, (streamKey) => this.sortPass.release(streamKey));
    const scene = this.sceneCache.get(clipId);
    if (scene) {
      releaseSplatSceneResources(scene);
      this.sceneCache.delete(clipId);
      releaseEffectorStorageBuffer(this.effectorOutputBuffers, clipId);
      // Also clean up particle buffers for this clip
      releaseParticleStorageBuffer(this.particleOutputBuffers, clipId);
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

    let scene = this.sceneCache.get(clipId);
    if (!scene) {
      log.debug('No scene uploaded for clip', { clipId });
      return null;
    }

    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }

    try {
      const {
        worldMatrix,
        layerOpacity,
        splatScale,
        nearPlane,
        farPlane,
        depthAlphaCutoff,
        maxSplats,
        sortFrequency,
        clearColor,
        precise,
      } = prepareSplatRenderParams(options);
      if (options?.graphBranch?.mesh) {
        const target = resolveSplatRenderTarget(this.renderTargetPool, this.lastRenderTargets, clipId, viewport, options.outputView);
        return this.meshPass.render(this.device, commandEncoder, clipId, options.graphBranch.mesh, camera, worldMatrix, target, options);
      }
      const cameraBindGroup = this.writeCameraUniforms(
        camera,
        worldMatrix,
        layerOpacity,
        depthAlphaCutoff,
        splatScale,
        nearPlane,
        farPlane,
      );
      if (!cameraBindGroup) {
        return null;
      }

      let activeSplatBuffer = scene.splatBuffer;
      let activeSplatCount = scene.splatCount;
      const effectors = options?.effectors ?? [];

      if (effectors.length > 0 && this.effectorCompute.isInitialized) {
        const localEffectors = this.effectorCompute.prepareLocalSplatEffectors(worldMatrix, effectors);
        if (localEffectors.length > 0) {
          const effectorOutput = getOrCreateEffectorStorageBuffer(
            this.device,
            this.effectorOutputBuffers,
            clipId,
            scene.splatCount,
          );
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

      // ── Step 2: Particle offsets (compute pass) [Wave 5] ──
      const particleSettings = options?.particleSettings;
      const clipLocalTime = options?.clipLocalTime ?? 0;

      if (
        particleSettings?.enabled &&
        particleSettings.effectType !== 'none' &&
        this.particleCompute.isInitialized
      ) {
        const particleOutput = getOrCreateParticleStorageBuffer(
          this.device,
          this.particleOutputBuffers,
          clipId,
          scene.splatCount,
        );
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

      if (maxSplats > 0) activeSplatCount = Math.min(activeSplatCount, maxSplats);
      const graph = this.graphPass.execute(this.device, commandEncoder, this.splatDataBindGroupLayout!, clipId,
        scene, activeSplatBuffer, activeSplatCount, activeSplatBuffer === scene.splatBuffer ? this.meshPass.getSource(clipId) : undefined,
        options?.graphBranch, clipLocalTime, worldMatrix, camera, precise);
      scene = graph.scene; activeSplatBuffer = graph.buffer; activeSplatCount = graph.count;
      const graphMovesPoints = graph.forceGpuSort;
      const effectiveSplatCount = maxSplats > 0
        ? Math.min(activeSplatCount, maxSplats)
        : activeSplatCount;

      // ── Step 3: Frustum Culling [Wave 4] ──────────────────────────────────
      const stream = this.drawStreams.get(clipId, options?.graphBranch?.id);
      let cullIndexBuffer: GPUBuffer | null = null;
      let hasValidatedCullResult = false;
      const workerSortFrame = updateWorkerSortFrame(
        scene,
        this.device.queue,
        camera.viewMatrix,
        worldMatrix,
        effectiveSplatCount,
        sortFrequency,
        precise || graphMovesPoints,
      );
      const { canUseWorkerSort, usedWorkerSort } = workerSortFrame;
      let drawCount = workerSortFrame.drawCount;

      if (
        !canUseWorkerSort &&
        !precise && !graphMovesPoints &&
        this.visibilityPass.isInitialized &&
        effectiveSplatCount > CULL_THRESHOLD
      ) {
        const cullResult = this.visibilityPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, effectiveSplatCount,
          camera.viewMatrix, camera.projectionMatrix, worldMatrix,
        );

        if (cullResult) {
          const validatedVisibleCount = stream.visibleCount;
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
          queueSplatVisibleCountReadback(
            this.device,
            readbackBuffer,
            (count) => { stream.visibleCount = count; },
          );
        }
      }

      // ── Step 4: Depth Sort (back-to-front) [Wave 4] ──────────────────────
      const gpuOrder = updateGpuSortFrame({
        stream,
        sortPass: this.sortPass,
        device: this.device,
        commandEncoder,
        activeSplatBuffer,
        identityIndexBuffer: scene.identityIndexBuffer,
        cullIndexBuffer,
        effectiveSplatCount,
        drawCount,
        canUseWorkerSort,
        precise: precise || graphMovesPoints,
        hasValidatedCullResult,
        sortFrequency: graphMovesPoints ? 1 : sortFrequency,
        viewMatrix: camera.viewMatrix,
        worldMatrix,
      });

      // ── Step 5: Rasterize ────────────────────────────────────────────────
      const targetView = resolveSplatRenderTarget(
        this.renderTargetPool,
        this.lastRenderTargets,
        clipId,
        viewport,
        options?.outputView,
      );

      const renderBindGroup = resolveSplatDrawBindGroup({
        device: this.device, layout: this.splatDataBindGroupLayout!, clipId, scene, stream,
        activeSplatBuffer, canUseWorkerSort, gpuOrder, cullIndexBuffer,
      });
      if (gpuOrder) drawCount = gpuOrder.count;

      const passEncoder = commandEncoder.beginRenderPass(
        buildSplatRenderPassDescriptor(clipId, targetView, clearColor, options),
      );

      passEncoder.setPipeline(this.getRenderPipeline(
        !!options?.depthView,
        options?.depthWrite === true,
        options?.colorWrite !== false,
        options?.outputView ? options.outputFormat : undefined,
      ));
      passEncoder.setBindGroup(0, renderBindGroup);
      passEncoder.setBindGroup(1, cameraBindGroup);

      recordSplatRenderDebug(log, this.renderDebugLoggedClips, this.lastRenderDebug, {
        branchId: options?.graphBranch?.id,
        sortMode: canUseWorkerSort ? 'worker' : gpuOrder ? 'gpu' : 'identity',
        clipId,
        sceneSplatCount: scene.splatCount,
        activeSplatCount,
        effectiveSplatCount,
        drawCount,
        viewport,
        backgroundColor: options?.backgroundColor,
        splatScale,
        nearPlane,
        farPlane,
        sortFrequency,
        cameraNear: camera.near,
        cameraFar: camera.far,
        colorWrite: options?.colorWrite !== false,
        hasParticleOverride: activeSplatBuffer !== scene.splatBuffer,
        usedCull: !!cullIndexBuffer,
        usedSort: usedWorkerSort || !!gpuOrder,
      });
      // Instanced draw: 4 vertices per quad, one instance per splat
      passEncoder.draw(4, drawCount, 0, 0);
      passEncoder.end();

      return targetView;
    } catch (err) {
      log.error('renderToTexture failed', { clipId, error: err });
      return null;
    }
  }

  /**
   * Called at start of each frame to reset per-frame state. Every command buffer recorded
   * since the previous call must have been submitted: per-dispatch uniform slots are
   * rewound and buffers retired by growth are destroyed here.
   */
  beginFrame(): void {
    this.graphPass.beginFrame(); this.meshPass.beginFrame(); this.sortPass.beginFrame();
    this.visibilityPass.beginFrame(); this.particleCompute.beginFrame(); this.effectorCompute.beginFrame();
    this.drawStreams.beginFrame((streamKey) => this.sortPass.release(streamKey));
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

    return readRenderTargetSummary(this.device, target);
  }

  dispose(): void {
    this.disposeGpuResources();
    this.device = null;
    this._initialized = false;
    log.info('GaussianSplatGpuRenderer disposed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private disposeGpuResources(): void {
    this.graphPass.dispose(); this.meshPass.dispose();
    // Release all scenes
    for (const [clipId, scene] of this.sceneCache) {
      releaseSplatSceneResources(scene);
      log.debug('Disposed scene buffer', { clipId });
    }
    this.sceneCache.clear();
    this.drawStreams.clear();
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

    // Nullify pipelines and layouts (they don't need explicit destruction)
    this.pipeline = null;
    this.pipelineWithDepth = null;
    this.pipelineWithDepthWrite = null;
    this.pipelineWithDepthWriteMask = null;
    this.splatDataBindGroupLayout = null;
    this.cameraBindGroupLayout = null;
  }

  private createPipeline(): void {
    if (!this.device) return;

    const bundle = createSplatRenderPipelines(this.device);
    this.splatDataBindGroupLayout = bundle.splatDataBindGroupLayout;
    this.cameraBindGroupLayout = bundle.cameraBindGroupLayout;
    this.pipeline = bundle.pipeline;
    this.pipelineWithDepth = bundle.pipelineWithDepth;
    this.pipelineWithDepthWrite = bundle.pipelineWithDepthWrite;
    this.pipelineWithDepthWriteMask = bundle.pipelineWithDepthWriteMask;
    log.debug('Render pipeline created');
  }

  private createCameraBuffer(): void {
    this.cameraUniformPool = [];
    this.cameraUniformCursor = 0;
  }

  private getCameraUniformResource(): SplatCameraUniformResource | null {
    if (!this.device || !this.cameraBindGroupLayout) return null;

    const index = this.cameraUniformCursor++;
    const existing = this.cameraUniformPool[index];
    if (existing) {
      return existing;
    }

    const resource = createSplatCameraUniformResource(
      this.device,
      this.cameraBindGroupLayout,
      index,
    );
    this.cameraUniformPool[index] = resource;
    return resource;
  }

  private getRenderPipeline(hasDepth: boolean, depthWrite: boolean, colorWrite: boolean, format?: GPUTextureFormat): GPURenderPipeline {
    const set = format && format !== 'rgba8unorm' && this.device ? splatPipelinesForFormat(this.device, format)
      : { pipeline: this.pipeline, pipelineWithDepth: this.pipelineWithDepth, pipelineWithDepthWrite: this.pipelineWithDepthWrite,
        pipelineWithDepthWriteMask: this.pipelineWithDepthWriteMask };
    if (!hasDepth) {
      return set.pipeline!;
    }
    if (depthWrite) {
      return colorWrite ? set.pipelineWithDepthWrite! : set.pipelineWithDepthWriteMask!;
    }
    return set.pipelineWithDepth!;
  }

  private writeCameraUniforms(
    camera: SplatCameraParams,
    worldMatrix: Float32Array,
    layerOpacity: number,
    depthAlphaCutoff: number,
    splatScale: number,
    nearPlane: number,
    farPlane: number,
  ): GPUBindGroup | null {
    if (!this.device) return null;
    const resource = this.getCameraUniformResource();
    if (!resource) return null;

    return writeSplatCameraUniforms(
      this.device,
      resource,
      camera,
      worldMatrix,
      layerOpacity,
      depthAlphaCutoff,
      splatScale,
      nearPlane,
      farPlane,
    );
  }
}

// ── HMR Singleton ─────────────────────────────────────────────────────────────

let instance: GaussianSplatGpuRenderer | null = import.meta.hot?.data?.gaussianSplatGpuRenderer ?? null;
if (import.meta.hot) {
  import.meta.hot.accept();
  if (instance) {
    Object.setPrototypeOf(instance, GaussianSplatGpuRenderer.prototype);
    instance.refreshAfterHmr();
  }
  import.meta.hot.dispose((data) => {
    data.gaussianSplatGpuRenderer = instance;
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
