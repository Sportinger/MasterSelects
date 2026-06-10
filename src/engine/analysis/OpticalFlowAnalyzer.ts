// GPU-accelerated Optical Flow Analyzer
// Uses Lucas-Kanade with Gaussian Pyramid for accurate motion detection

import opticalFlowShader from '../../shaders/opticalflow.wgsl?raw';
import { Logger } from '../../services/logger';
import {
  ANALYSIS_WIDTH,
  ANALYSIS_HEIGHT,
  PYRAMID_LEVELS,
  MOTION_THRESHOLD,
  parseFlowStats,
  classifyMotion,
  getPyramidDimensions,
  type FlowStats,
  type MotionResult,
} from './opticalFlow/flowStatsMath';

export type { MotionResult } from './opticalFlow/flowStatsMath';

const log = Logger.create('OpticalFlowAnalyzer');

export class OpticalFlowAnalyzer {
  private device: GPUDevice;
  private initialized = false;

  // Compute pipelines
  private grayscalePipeline: GPUComputePipeline | null = null;
  private pyramidDownsamplePipeline: GPUComputePipeline | null = null;
  private spatialGradientsPipeline: GPUComputePipeline | null = null;
  private temporalGradientPipeline: GPUComputePipeline | null = null;
  private lucasKanadePipeline: GPUComputePipeline | null = null;
  private flowStatisticsPipeline: GPUComputePipeline | null = null;
  private clearStatsPipeline: GPUComputePipeline | null = null;

  // Bind group layouts
  private grayscaleLayout: GPUBindGroupLayout | null = null;
  private pyramidDownsampleLayout: GPUBindGroupLayout | null = null;
  private spatialGradientsLayout: GPUBindGroupLayout | null = null;
  private temporalGradientLayout: GPUBindGroupLayout | null = null;
  private lucasKanadeLayout: GPUBindGroupLayout | null = null;
  private flowStatisticsLayout: GPUBindGroupLayout | null = null;
  private clearStatsLayout: GPUBindGroupLayout | null = null;

  // Textures for current and previous frames
  private inputTexture: GPUTexture | null = null;
  private grayscaleTextures: GPUTexture[] = []; // [current, previous]
  private pyramidTextures: GPUTexture[][] = []; // [frame][level]
  private gradientTextures: { ix: GPUTexture; iy: GPUTexture; it: GPUTexture }[] = [];
  private flowTextures: GPUTexture[] = []; // One per pyramid level
  private blurTempTexture: GPUTexture | null = null;

  // Statistics buffer
  private statsBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private lkParamsBuffer: GPUBuffer | null = null;
  private statsParamsBuffer: GPUBuffer | null = null;

  // Track if we have a previous frame
  private hasPreviousFrame = false;
  private frameIndex = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      await this.createPipelines();
      this.createTextures();
      this.createBuffers();
      this.initialized = true;
      log.info('Analyzer initialized');
      return true;
    } catch (error) {
      log.error('Failed to initialize', error);
      return false;
    }
  }

  private async createPipelines(): Promise<void> {
    const shaderModule = this.device.createShaderModule({
      code: opticalFlowShader,
    });

    // Grayscale pipeline
    this.grayscaleLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.grayscalePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.grayscaleLayout] }),
      compute: { module: shaderModule, entryPoint: 'grayscaleMain' },
    });

    // Pyramid downsample pipeline
    this.pyramidDownsampleLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.pyramidDownsamplePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.pyramidDownsampleLayout] }),
      compute: { module: shaderModule, entryPoint: 'pyramidDownsampleMain' },
    });

    // Spatial gradients pipeline
    this.spatialGradientsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.spatialGradientsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.spatialGradientsLayout] }),
      compute: { module: shaderModule, entryPoint: 'spatialGradientsMain' },
    });

    // Temporal gradient pipeline
    this.temporalGradientLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'r32float' } },
      ],
    });
    this.temporalGradientPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.temporalGradientLayout] }),
      compute: { module: shaderModule, entryPoint: 'temporalGradientMain' },
    });

    // Lucas-Kanade pipeline
    this.lucasKanadeLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
      ],
    });
    this.lucasKanadePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.lucasKanadeLayout] }),
      compute: { module: shaderModule, entryPoint: 'lucasKanadeMain' },
    });

    // Flow statistics pipeline
    this.flowStatisticsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.flowStatisticsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.flowStatisticsLayout] }),
      compute: { module: shaderModule, entryPoint: 'flowStatisticsMain' },
    });

    // Clear stats pipeline
    this.clearStatsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.clearStatsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.clearStatsLayout] }),
      compute: { module: shaderModule, entryPoint: 'clearStatsMain' },
    });
  }

  private createTextures(): void {
    // Input texture for uploaded frame (RGBA)
    this.inputTexture = this.device.createTexture({
      size: [ANALYSIS_WIDTH, ANALYSIS_HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Grayscale textures (current and previous frame)
    // Need COPY_SRC to copy to pyramid level 0
    for (let i = 0; i < 2; i++) {
      this.grayscaleTextures.push(this.device.createTexture({
        size: [ANALYSIS_WIDTH, ANALYSIS_HEIGHT],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
      }));
    }

    // Blur temporary texture
    this.blurTempTexture = this.device.createTexture({
      size: [ANALYSIS_WIDTH, ANALYSIS_HEIGHT],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    // Pyramid textures for each frame
    // Level 0 needs COPY_DST (destination of copy from grayscale)
    for (let frame = 0; frame < 2; frame++) {
      const pyramid: GPUTexture[] = [];
      let w = ANALYSIS_WIDTH;
      let h = ANALYSIS_HEIGHT;
      for (let level = 0; level < PYRAMID_LEVELS; level++) {
        pyramid.push(this.device.createTexture({
          size: [w, h],
          format: 'r32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING |
                 (level === 0 ? GPUTextureUsage.COPY_DST : 0),
        }));
        w = Math.max(1, Math.floor(w / 2));
        h = Math.max(1, Math.floor(h / 2));
      }
      this.pyramidTextures.push(pyramid);
    }

    // Gradient textures for each pyramid level
    let w = ANALYSIS_WIDTH;
    let h = ANALYSIS_HEIGHT;
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      this.gradientTextures.push({
        ix: this.device.createTexture({
          size: [w, h],
          format: 'r32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }),
        iy: this.device.createTexture({
          size: [w, h],
          format: 'r32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }),
        it: this.device.createTexture({
          size: [w, h],
          format: 'r32float',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        }),
      });
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }

    // Flow textures for each pyramid level
    w = ANALYSIS_WIDTH;
    h = ANALYSIS_HEIGHT;
    for (let level = 0; level < PYRAMID_LEVELS; level++) {
      this.flowTextures.push(this.device.createTexture({
        size: [w, h],
        format: 'rg32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      }));
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
  }

  private createBuffers(): void {
    // Statistics buffer (matches FlowStats struct in shader)
    // sumMagnitude(4) + sumMagnitudeSq(4) + sumVx(4) + sumVy(4) + pixelCount(4) + significantPixels(4) + maxMagnitude(4) + directionHistogram(8*4) = 60 bytes
    // Align to 64 bytes
    this.statsBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Staging buffer for readback
    this.stagingBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Lucas-Kanade params buffer
    this.lkParamsBuffer = this.device.createBuffer({
      size: 16, // windowRadius(4) + minEigenvalue(4) + pyramidScale(4) + pad(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Stats params buffer
    this.statsParamsBuffer = this.device.createBuffer({
      size: 16, // magnitudeThreshold(4) + pad(12)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Initialize stats params
    const statsParamsData = new Float32Array([MOTION_THRESHOLD, 0, 0, 0]);
    this.device.queue.writeBuffer(this.statsParamsBuffer, 0, statsParamsData);
  }

  /**
   * Analyze motion between current frame and previous frame
   */
  async analyzeFrame(bitmap: ImageBitmap): Promise<MotionResult> {
    if (!this.initialized) {
      const success = await this.initialize();
      if (!success) {
        return { total: 0, global: 0, local: 0, isSceneCut: false };
      }
    }

    const currentFrameIndex = this.frameIndex % 2;
    const previousFrameIndex = (this.frameIndex + 1) % 2;

    // Upload frame to GPU
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.inputTexture! },
      [ANALYSIS_WIDTH, ANALYSIS_HEIGHT]
    );

    const commandEncoder = this.device.createCommandEncoder();

    // Step 1: Convert to grayscale
    this.dispatchGrayscale(commandEncoder, currentFrameIndex);

    // Step 2: Build Gaussian pyramid
    this.dispatchPyramid(commandEncoder, currentFrameIndex);

    // If we have a previous frame, compute optical flow
    if (this.hasPreviousFrame) {
      // Step 3: Compute flow at each pyramid level (coarse to fine)
      for (let level = PYRAMID_LEVELS - 1; level >= 0; level--) {
        // Compute spatial gradients on current frame
        this.dispatchSpatialGradients(commandEncoder, currentFrameIndex, level);

        // Compute temporal gradient between frames
        this.dispatchTemporalGradient(commandEncoder, currentFrameIndex, previousFrameIndex, level);

        // Lucas-Kanade optical flow
        this.dispatchLucasKanade(commandEncoder, level);
      }

      // Step 4: Compute flow statistics
      this.dispatchClearStats(commandEncoder);
      this.dispatchFlowStatistics(commandEncoder);
    }

    // Submit GPU commands
    this.device.queue.submit([commandEncoder.finish()]);

    // Read back statistics
    let result: MotionResult = { total: 0, global: 0, local: 0, isSceneCut: false };

    if (this.hasPreviousFrame) {
      const stats = await this.readStats();
      result = classifyMotion(stats);
    }

    // Update state for next frame
    this.hasPreviousFrame = true;
    this.frameIndex++;

    return result;
  }

  private dispatchGrayscale(encoder: GPUCommandEncoder, frameIndex: number): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.grayscaleLayout!,
      entries: [
        { binding: 0, resource: this.inputTexture!.createView() },
        { binding: 1, resource: this.grayscaleTextures[frameIndex].createView() },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.grayscalePipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(ANALYSIS_WIDTH / 8),
      Math.ceil(ANALYSIS_HEIGHT / 8)
    );
    pass.end();
  }

  private dispatchPyramid(encoder: GPUCommandEncoder, frameIndex: number): void {
    // Level 0 is the grayscale image (copy it)
    // Actually, we need to blur and then downsample

    // First, copy grayscale to pyramid level 0
    encoder.copyTextureToTexture(
      { texture: this.grayscaleTextures[frameIndex] },
      { texture: this.pyramidTextures[frameIndex][0] },
      [ANALYSIS_WIDTH, ANALYSIS_HEIGHT]
    );

    // Build remaining pyramid levels
    let w = ANALYSIS_WIDTH;
    let h = ANALYSIS_HEIGHT;
    for (let level = 1; level < PYRAMID_LEVELS; level++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));

      const bindGroup = this.device.createBindGroup({
        layout: this.pyramidDownsampleLayout!,
        entries: [
          { binding: 0, resource: this.pyramidTextures[frameIndex][level - 1].createView() },
          { binding: 1, resource: this.pyramidTextures[frameIndex][level].createView() },
        ],
      });

      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pyramidDownsamplePipeline!);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.end();
    }
  }

  private dispatchSpatialGradients(encoder: GPUCommandEncoder, frameIndex: number, level: number): void {
    const dims = getPyramidDimensions(level);

    const bindGroup = this.device.createBindGroup({
      layout: this.spatialGradientsLayout!,
      entries: [
        { binding: 0, resource: this.pyramidTextures[frameIndex][level].createView() },
        { binding: 1, resource: this.gradientTextures[level].ix.createView() },
        { binding: 2, resource: this.gradientTextures[level].iy.createView() },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.spatialGradientsPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(dims.w / 8), Math.ceil(dims.h / 8));
    pass.end();
  }

  private dispatchTemporalGradient(encoder: GPUCommandEncoder, currentFrame: number, previousFrame: number, level: number): void {
    const dims = getPyramidDimensions(level);

    const bindGroup = this.device.createBindGroup({
      layout: this.temporalGradientLayout!,
      entries: [
        { binding: 0, resource: this.pyramidTextures[currentFrame][level].createView() },
        { binding: 1, resource: this.pyramidTextures[previousFrame][level].createView() },
        { binding: 2, resource: this.gradientTextures[level].it.createView() },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.temporalGradientPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(dims.w / 8), Math.ceil(dims.h / 8));
    pass.end();
  }

  private dispatchLucasKanade(encoder: GPUCommandEncoder, level: number): void {
    const dims = getPyramidDimensions(level);

    // Update LK params
    const windowRadius = 2; // 5x5 window
    const minEigenvalue = 0.001;
    const pyramidScale = level < PYRAMID_LEVELS - 1 ? 2.0 : 0.0;

    const paramsData = new ArrayBuffer(16);
    const paramsView = new DataView(paramsData);
    paramsView.setUint32(0, windowRadius, true);
    paramsView.setFloat32(4, minEigenvalue, true);
    paramsView.setFloat32(8, pyramidScale, true);
    paramsView.setUint32(12, 0, true); // pad
    this.device.queue.writeBuffer(this.lkParamsBuffer!, 0, paramsData);

    // Use flow from coarser level as initial estimate (or create dummy texture for finest level)
    const prevFlowTexture = level < PYRAMID_LEVELS - 1
      ? this.flowTextures[level + 1]
      : this.createDummyFlowTexture();

    const bindGroup = this.device.createBindGroup({
      layout: this.lucasKanadeLayout!,
      entries: [
        { binding: 0, resource: this.gradientTextures[level].ix.createView() },
        { binding: 1, resource: this.gradientTextures[level].iy.createView() },
        { binding: 2, resource: this.gradientTextures[level].it.createView() },
        { binding: 3, resource: { buffer: this.lkParamsBuffer! } },
        { binding: 4, resource: this.flowTextures[level].createView() },
        { binding: 5, resource: prevFlowTexture.createView() },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.lucasKanadePipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(dims.w / 8), Math.ceil(dims.h / 8));
    pass.end();
  }

  private dummyFlowTexture: GPUTexture | null = null;

  private createDummyFlowTexture(): GPUTexture {
    if (!this.dummyFlowTexture) {
      this.dummyFlowTexture = this.device.createTexture({
        size: [1, 1],
        format: 'rg32float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      });
    }
    return this.dummyFlowTexture;
  }

  private dispatchClearStats(encoder: GPUCommandEncoder): void {
    const bindGroup = this.device.createBindGroup({
      layout: this.clearStatsLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.statsBuffer! } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.clearStatsPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  private dispatchFlowStatistics(encoder: GPUCommandEncoder): void {
    // Use finest level flow (level 0)
    const bindGroup = this.device.createBindGroup({
      layout: this.flowStatisticsLayout!,
      entries: [
        { binding: 0, resource: this.flowTextures[0].createView() },
        { binding: 1, resource: { buffer: this.statsBuffer! } },
        { binding: 2, resource: { buffer: this.statsParamsBuffer! } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.flowStatisticsPipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(ANALYSIS_WIDTH / 8),
      Math.ceil(ANALYSIS_HEIGHT / 8)
    );
    pass.end();

    // Copy stats to staging buffer
    encoder.copyBufferToBuffer(this.statsBuffer!, 0, this.stagingBuffer!, 0, 64);
  }

  private async readStats(): Promise<FlowStats> {
    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(this.stagingBuffer!.getMappedRange().slice(0));
    this.stagingBuffer!.unmap();
    return parseFlowStats(data);
  }

  /**
   * Reset analyzer state (call when switching clips)
   */
  reset(): void {
    this.hasPreviousFrame = false;
    this.frameIndex = 0;
  }

  /**
   * Clean up GPU resources
   */
  destroy(): void {
    this.inputTexture?.destroy();
    this.blurTempTexture?.destroy();
    this.dummyFlowTexture?.destroy();

    for (const tex of this.grayscaleTextures) {
      tex.destroy();
    }
    for (const pyramid of this.pyramidTextures) {
      for (const tex of pyramid) {
        tex.destroy();
      }
    }
    for (const grads of this.gradientTextures) {
      grads.ix.destroy();
      grads.iy.destroy();
      grads.it.destroy();
    }
    for (const tex of this.flowTextures) {
      tex.destroy();
    }

    this.statsBuffer?.destroy();
    this.stagingBuffer?.destroy();
    this.lkParamsBuffer?.destroy();
    this.statsParamsBuffer?.destroy();

    this.initialized = false;
    log.debug('Analyzer destroyed');
  }
}

// Singleton instance (lazy initialized)
let analyzerInstance: OpticalFlowAnalyzer | null = null;

export async function getOpticalFlowAnalyzer(device: GPUDevice): Promise<OpticalFlowAnalyzer> {
  if (!analyzerInstance) {
    analyzerInstance = new OpticalFlowAnalyzer(device);
    await analyzerInstance.initialize();
  }
  return analyzerInstance;
}

export function resetOpticalFlowAnalyzer(): void {
  analyzerInstance?.reset();
}

export function destroyOpticalFlowAnalyzer(): void {
  analyzerInstance?.destroy();
  analyzerInstance = null;
}
