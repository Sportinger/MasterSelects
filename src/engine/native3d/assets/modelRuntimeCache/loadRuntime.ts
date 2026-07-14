import {
  computeModelBounds,
  normalizeModelPrimitives,
} from './geometry';
import { Logger } from '../../../../services/logger';
import {
  parseGlb,
  parseGltfPrimitives,
  resolveGltfBuffers,
  resolveGltfTextures,
} from './gltf';
import { parseAsciiFbx } from './fbx';
import { decodeText, fetchModelBytes, fetchModelText } from './io';
import { parseObj, resolveObjMaterials } from './obj';
import type { GltfAsset, ModelRuntimeBounds, ModelRuntimeData } from './types';

const log = Logger.create('ModelRuntimeCache');

export async function loadModelRuntime(
  url: string,
  resolvedFileName: string,
  normalizationBounds?: ModelRuntimeBounds,
  normalizationKey?: string,
): Promise<ModelRuntimeData | null> {
  const extension = resolvedFileName.split('.').pop()?.toLowerCase() ?? '';

  if (extension === 'obj') {
    const text = await fetchModelText(url);
    if (!text) {
      return null;
    }
    const parsedPrimitives = parseObj(text, await resolveObjMaterials(text, url));
    const sourceBounds = computeModelBounds(parsedPrimitives) ?? undefined;
    const primitives = normalizeModelPrimitives(parsedPrimitives, normalizationBounds ?? sourceBounds ?? null);
    return primitives.length > 0
      ? {
          url,
          fileName: resolvedFileName,
          format: 'obj',
          primitives,
          ...(sourceBounds ? { sourceBounds } : {}),
          ...(normalizationKey ? { normalizationKey } : {}),
        }
      : null;
  }

  if (extension === 'fbx') {
    const text = await fetchModelText(url);
    if (!text) {
      log.warn('FBX model could not be read', { fileName: resolvedFileName, url });
      return null;
    }
    const parsedPrimitives = parseAsciiFbx(text);
    const sourceBounds = computeModelBounds(parsedPrimitives) ?? undefined;
    const primitives = normalizeModelPrimitives(parsedPrimitives, normalizationBounds ?? sourceBounds ?? null);
    if (primitives.length === 0) {
      log.warn('FBX model parsed without renderable mesh primitives', {
        fileName: resolvedFileName,
        textLength: text.length,
      });
    }
    return primitives.length > 0
      ? {
          url,
          fileName: resolvedFileName,
          format: 'fbx',
          primitives,
          ...(sourceBounds ? { sourceBounds } : {}),
          ...(normalizationKey ? { normalizationKey } : {}),
        }
      : null;
  }

  const fetched = await fetchModelBytes(url);
  if (!fetched) {
    return null;
  }
  const buffer = fetched.bytes;
  let gltf: GltfAsset | null = null;
  let binaryChunk: ArrayBuffer | undefined;
  let format: 'gltf' | 'glb' = extension === 'gltf' ? 'gltf' : 'glb';

  const parsedGlb = parseGlb(buffer);
  if (parsedGlb) {
    gltf = parsedGlb.json;
    binaryChunk = parsedGlb.buffers[0];
    format = 'glb';
  } else {
    try {
      gltf = JSON.parse(decodeText(buffer)) as GltfAsset;
      format = 'gltf';
    } catch {
      return null;
    }
  }

  const buffers = await resolveGltfBuffers(gltf, url, binaryChunk);
  if (!buffers) {
    return null;
  }

  const textureRuntimes = await resolveGltfTextures(gltf, buffers, url);
  const parsedPrimitives = parseGltfPrimitives(gltf, buffers, textureRuntimes);
  const sourceBounds = computeModelBounds(parsedPrimitives) ?? undefined;
  const primitives = normalizeModelPrimitives(parsedPrimitives, normalizationBounds ?? sourceBounds ?? null);
  if (primitives.length === 0) {
    return null;
  }

  return {
    url,
    fileName: resolvedFileName,
    format,
    primitives,
    ...(sourceBounds ? { sourceBounds } : {}),
    ...(normalizationKey ? { normalizationKey } : {}),
  };
}
