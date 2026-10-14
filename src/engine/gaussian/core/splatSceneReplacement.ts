// Live replacement of loaded Gaussian splat scenes.
//
// Sources whose data changes while their clips stay in place (for example a
// running Brush training) swap the GPU scene under its existing scene key. The
// previous scene stays visible until the new data is parsed, so cameras,
// clip settings, and the viewer's orbit are untouched.

import { getSplatCache, loadGaussianSplatAsset } from '../loaders';
import type { GaussianSplatAsset } from '../loaders';
import { getGaussianSplatGpuRenderer } from './GaussianSplatGpuRenderer';

const revisions = new Map<string, number>();
const replacedAssets = new Map<string, GaussianSplatAsset>();

/** Monotonic per-scene revision. Loads started before a replacement must not upload stale data. */
export function getSplatSceneReplacementRevision(sceneKey: string): number {
  return revisions.get(sceneKey) ?? 0;
}

/** Latest replaced data. It supersedes the clip's media file until the replacement is forgotten. */
export function getReplacedSplatSceneAsset(sceneKey: string): GaussianSplatAsset | null {
  return replacedAssets.get(sceneKey) ?? null;
}

/**
 * Parse `file` and upload it under `sceneKey`. Resolves to false when a newer
 * replacement for the same scene superseded this one while it was parsing.
 */
export async function replaceGaussianSplatScene(sceneKey: string, file: File): Promise<boolean> {
  const revision = getSplatSceneReplacementRevision(sceneKey) + 1;
  revisions.set(sceneKey, revision);
  const asset = await loadGaussianSplatAsset(file);
  if (revisions.get(sceneKey) !== revision) return false;
  const buffer = asset.frames[0]?.buffer;
  if (!buffer || buffer.splatCount <= 0) throw new Error(`${file.name} contains no splats.`);
  replacedAssets.set(sceneKey, asset);
  getSplatCache().put(sceneKey, asset);
  const renderer = getGaussianSplatGpuRenderer();
  // Without a GPU device yet, the regular scene load picks up the replaced asset.
  if (!renderer.isInitialized) return true;
  if (!renderer.uploadScene(sceneKey, { splatCount: buffer.splatCount, data: buffer.data })) {
    throw new Error(`Splat scene ${sceneKey} could not be uploaded to the GPU.`);
  }
  return true;
}

/**
 * Drop the runtime override. With `release`, the uploaded data goes too and a
 * clip that still uses this scene key reloads its own media file; without it,
 * the uploaded scene stays (its media file now holds the same data).
 */
export function forgetSplatSceneReplacement(sceneKey: string, release = true): void {
  if (!replacedAssets.has(sceneKey)) return;
  replacedAssets.delete(sceneKey);
  revisions.set(sceneKey, getSplatSceneReplacementRevision(sceneKey) + 1);
  if (!release) return;
  getSplatCache().remove(sceneKey);
  getGaussianSplatGpuRenderer().releaseScene(sceneKey);
}
