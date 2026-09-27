import type { FlockMeshData } from './flockMeshes';

/** Runtime resource boundary shared by main-thread and worker render owners. */
export interface FlockRenderAssets {
  model(assetId: string): { mesh?: FlockMeshData; revision?: number };
  pigment(assetId: string): { view: GPUTextureView; sampler: GPUSampler };
}
