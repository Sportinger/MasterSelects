import { Logger } from '../../../../services/logger';
import {
  computeNormalMatrix,
  computeNormals,
  identityMat4,
  mat4FromTrs,
  multiplyMat4,
  transformNormal,
  transformPosition,
} from './geometry';
import { readAccessorFloats, readAccessorIndices } from './gltfAccessors';
import { decodeDataUri, decodeText, fetchModelBytes, resolveModelSiblingUrl, sliceBuffer } from './io';
import { createTextureFromBytes } from './texture';
import type { GltfAsset, ModelColor, ModelRuntimeTexture, PendingPrimitive } from './types';
import { DEFAULT_MODEL_COLOR } from './types';

const log = Logger.create('ModelRuntimeCache');

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

export function parseGlb(buffer: ArrayBuffer): { json: GltfAsset; buffers: ArrayBuffer[] } | null {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return null;
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    return null;
  }

  let offset = 12;
  let jsonChunk: ArrayBuffer | null = null;
  let binChunk: ArrayBuffer | null = null;

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.byteLength) {
      break;
    }

    const chunk = buffer.slice(chunkStart, chunkEnd);
    if (chunkType === GLB_JSON_CHUNK) {
      jsonChunk = chunk;
    } else if (chunkType === GLB_BIN_CHUNK) {
      binChunk = chunk;
    }

    offset = chunkEnd;
  }

  if (!jsonChunk) {
    return null;
  }

  const json = JSON.parse(decodeText(jsonChunk)) as GltfAsset;
  const buffers = (json.buffers ?? []).map((entry, index) =>
    index === 0 && !entry.uri && binChunk ? binChunk : new ArrayBuffer(entry.byteLength),
  );
  return { json, buffers };
}

export async function resolveGltfBuffers(
  gltf: GltfAsset,
  sourceUrl: string,
  embeddedGlbBin?: ArrayBuffer,
): Promise<ArrayBuffer[] | null> {
  const buffers = gltf.buffers ?? [];
  const resolved: ArrayBuffer[] = [];

  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i]!;
    if (!buffer.uri) {
      if (embeddedGlbBin) {
        resolved.push(embeddedGlbBin);
        continue;
      }
      return null;
    }

    if (buffer.uri.startsWith('data:')) {
      const decoded = decodeDataUri(buffer.uri);
      if (!decoded) {
        return null;
      }
      resolved.push(decoded);
      continue;
    }

    const resolvedUrl = resolveModelSiblingUrl(sourceUrl, buffer.uri);
    if (!resolvedUrl) {
      return null;
    }
    const fetched = await fetchModelBytes(resolvedUrl);
    if (!fetched) {
      return null;
    }
    resolved.push(fetched.bytes);
  }

  return resolved;
}

export async function resolveGltfTextures(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  sourceUrl: string,
): Promise<Array<ModelRuntimeTexture | null>> {
  const images = gltf.images ?? [];
  const imageTextures: Array<ModelRuntimeTexture | null> = [];

  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]!;

    if (image.uri?.startsWith('data:')) {
      const decoded = decodeDataUri(image.uri);
      imageTextures[index] = decoded ? await createTextureFromBytes(decoded, image.mimeType) : null;
      continue;
    }

    if (image.uri) {
      try {
        const imageUrl = resolveModelSiblingUrl(sourceUrl, image.uri);
        if (!imageUrl) {
          imageTextures[index] = null;
          continue;
        }
        const fetched = await fetchModelBytes(imageUrl);
        imageTextures[index] = fetched
          ? await createTextureFromBytes(fetched.bytes, image.mimeType ?? fetched.contentType)
          : null;
      } catch (error) {
        log.warn('Failed to fetch model texture', { uri: image.uri, error });
        imageTextures[index] = null;
      }
      continue;
    }

    if (image.bufferView != null) {
      const bufferView = gltf.bufferViews?.[image.bufferView];
      const buffer = bufferView ? buffers[bufferView.buffer] : undefined;
      imageTextures[index] = buffer
        ? await createTextureFromBytes(
            sliceBuffer(buffer, bufferView?.byteOffset ?? 0, bufferView?.byteLength ?? 0),
            image.mimeType,
          )
        : null;
      continue;
    }

    imageTextures[index] = null;
  }

  return (gltf.textures ?? []).map((texture) =>
    texture.source == null ? null : imageTextures[texture.source] ?? null,
  );
}

function readMaterialColor(gltf: GltfAsset, materialIndex: number | undefined): ModelColor {
  if (materialIndex == null) {
    return DEFAULT_MODEL_COLOR;
  }

  const factor = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor;
  if (!factor || factor.length < 3) {
    return DEFAULT_MODEL_COLOR;
  }

  return [
    Number.isFinite(factor[0]) ? factor[0]! : DEFAULT_MODEL_COLOR[0],
    Number.isFinite(factor[1]) ? factor[1]! : DEFAULT_MODEL_COLOR[1],
    Number.isFinite(factor[2]) ? factor[2]! : DEFAULT_MODEL_COLOR[2],
    Number.isFinite(factor[3]) ? factor[3]! : DEFAULT_MODEL_COLOR[3],
  ];
}

function readMaterialBaseColorTexture(
  gltf: GltfAsset,
  textureRuntimes: Array<ModelRuntimeTexture | null>,
  materialIndex: number | undefined,
): ModelRuntimeTexture | undefined {
  if (materialIndex == null) {
    return undefined;
  }

  const textureIndex = gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (textureIndex == null) {
    return undefined;
  }

  return textureRuntimes[textureIndex] ?? undefined;
}

function readMaterialUnlit(
  gltf: GltfAsset,
  materialIndex: number | undefined,
  baseColorTexture: ModelRuntimeTexture | undefined,
): boolean {
  if (materialIndex == null) {
    return false;
  }

  const material = gltf.materials?.[materialIndex];
  return !!material?.extensions?.KHR_materials_unlit || !!baseColorTexture;
}

export function parseGltfPrimitives(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  textureRuntimes: Array<ModelRuntimeTexture | null>,
): PendingPrimitive[] {
  const primitives: PendingPrimitive[] = [];
  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex] ?? gltf.scenes?.[0];
  const rootNodes = scene?.nodes ?? [];

  const visitNode = (nodeIndex: number, parentMatrix: Float32Array): void => {
    const node = gltf.nodes?.[nodeIndex];
    if (!node) {
      return;
    }

    const localMatrix = node.matrix
      ? new Float32Array(node.matrix)
      : mat4FromTrs(node.translation, node.rotation, node.scale);
    const worldMatrix = multiplyMat4(parentMatrix, localMatrix);
    const normalMatrix = computeNormalMatrix(worldMatrix);

    if (node.mesh != null) {
      const mesh = gltf.meshes?.[node.mesh];
      for (const primitive of mesh?.primitives ?? []) {
        if ((primitive.mode ?? 4) !== 4) {
          continue;
        }

        const positionAccessor = primitive.attributes.POSITION;
        if (positionAccessor == null) {
          continue;
        }

        const positions = readAccessorFloats(gltf, buffers, positionAccessor);
        if (!positions || positions.length === 0) {
          continue;
        }

        const vertexCount = Math.floor(positions.length / 3);
        const indices = readAccessorIndices(gltf, buffers, primitive.indices, vertexCount);
        const sourceNormals = primitive.attributes.NORMAL != null
          ? readAccessorFloats(gltf, buffers, primitive.attributes.NORMAL)
          : null;
        const sourceTexcoords = primitive.attributes.TEXCOORD_0 != null
          ? readAccessorFloats(gltf, buffers, primitive.attributes.TEXCOORD_0)
          : null;

        const transformedPositions = new Float32Array(positions.length);
        for (let i = 0; i < vertexCount; i += 1) {
          const transformed = transformPosition(
            worldMatrix,
            positions[i * 3] ?? 0,
            positions[i * 3 + 1] ?? 0,
            positions[i * 3 + 2] ?? 0,
          );
          transformedPositions[i * 3] = transformed[0];
          transformedPositions[i * 3 + 1] = transformed[1];
          transformedPositions[i * 3 + 2] = transformed[2];
        }

        let transformedNormals: Float32Array;
        if (sourceNormals && sourceNormals.length === positions.length) {
          transformedNormals = new Float32Array(sourceNormals.length);
          for (let i = 0; i < vertexCount; i += 1) {
            const transformed = transformNormal(
              normalMatrix,
              sourceNormals[i * 3] ?? 0,
              sourceNormals[i * 3 + 1] ?? 0,
              sourceNormals[i * 3 + 2] ?? 1,
            );
            transformedNormals[i * 3] = transformed[0];
            transformedNormals[i * 3 + 1] = transformed[1];
            transformedNormals[i * 3 + 2] = transformed[2];
          }
        } else {
          transformedNormals = computeNormals(transformedPositions, indices);
        }

        const baseColorTexture = readMaterialBaseColorTexture(gltf, textureRuntimes, primitive.material);
        const unlit = readMaterialUnlit(gltf, primitive.material, baseColorTexture);

        primitives.push({
          positions: transformedPositions,
          normals: transformedNormals,
          ...(sourceTexcoords && sourceTexcoords.length >= vertexCount * 2
            ? { texcoords: sourceTexcoords }
            : {}),
          indices,
          baseColor: readMaterialColor(gltf, primitive.material),
          ...(baseColorTexture ? { baseColorTexture } : {}),
          ...(unlit ? { unlit: true } : {}),
        });
      }
    }

    for (const childIndex of node.children ?? []) {
      visitNode(childIndex, worldMatrix);
    }
  };

  for (const nodeIndex of rootNodes) {
    visitNode(nodeIndex, identityMat4());
  }

  return primitives;
}
