// Gaussian splat module — public API

// Existing gaussian-avatar renderer (WebGL canvas-copy bridge)
export { GaussianSplatSceneRenderer, getGaussianSplatSceneRenderer } from './GaussianSplatSceneRenderer';

// Loader stack
export {
  loadGaussianSplatAsset,
  loadGaussianSplatAssetCached,
  parseGaussianSplatHeader,
  getSplatCache,
  detectFormat,
} from './loaders';

export type {
  GaussianSplatFormat,
  GaussianSplatMetadata,
  GaussianSplatBuffer,
  GaussianSplatFrame,
  GaussianSplatAsset,
  GaussianSplatLoadOptions,
  GaussianSplatLoadProgress,
  GaussianSplatLoadProgressCallback,
  SplatCache,
} from './loaders';

// WebGPU GPU renderer core
export { GaussianSplatGpuRenderer, getGaussianSplatGpuRenderer } from './core/GaussianSplatGpuRenderer';
export type { UploadableSplatData, SplatCameraParams, SplatRenderOptions } from './core/GaussianSplatGpuRenderer';
export { SplatRenderTargetPool } from './core/SplatRenderTargetPool';
export { buildSplatCamera } from './core/SplatCameraUtils';

// Wave 4: GPU sort + cull for large scenes
export { SplatVisibilityPass } from './core/SplatVisibilityPass';
export { SplatSortPass } from './core/SplatSortPass';

// Wave 5: Temporal 4D playback
export { sampleTemporalFrame } from './temporal/TemporalSampler';
export type { TemporalSampleResult } from './temporal/TemporalSampler';
export { FrameBufferSwapper } from './temporal/FrameBufferSwapper';
export type { PreparedFrameBuffers } from './temporal/FrameBufferSwapper';

// Wave 5: Particle effects
export { ParticleCompute } from './effects/ParticleCompute';
