import { computeNormals, normalizeVector3 } from './geometry';
import { fetchModelBytes, fetchModelText, resolveModelSiblingUrl } from './io';
import { createTextureFromBytes } from './texture';
import type { ModelColor, ModelRuntimeTexture, PendingPrimitive } from './types';
import { DEFAULT_MODEL_COLOR } from './types';

export interface ObjMaterialRuntime {
  baseColor: ModelColor;
  baseColorTexture?: ModelRuntimeTexture;
  unlit?: boolean;
}

function parseSignedIndex(raw: string, total: number): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  return value > 0 ? value - 1 : total + value;
}

function parseObjMaterialLibraries(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith('mtllib '))
    .map((line) => line.slice(7).trim())
    .filter(Boolean);
}

function parseTexturePath(raw: string): string | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
}

async function resolveMtlMaterials(mtlText: string, mtlUrl: string): Promise<Map<string, ObjMaterialRuntime>> {
  const materials = new Map<string, ObjMaterialRuntime & { mapKd?: string }>();
  let currentName: string | null = null;

  for (const rawLine of mtlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [keywordRaw, ...parts] = line.split(/\s+/);
    const keyword = keywordRaw?.toLowerCase();

    if (keyword === 'newmtl') {
      currentName = parts.join(' ').trim();
      if (currentName) {
        materials.set(currentName, { baseColor: DEFAULT_MODEL_COLOR });
      }
      continue;
    }

    if (!currentName) continue;
    const material = materials.get(currentName);
    if (!material) continue;

    if (keyword === 'kd' && parts.length >= 3) {
      material.baseColor = [
        Number(parts[0] ?? DEFAULT_MODEL_COLOR[0]),
        Number(parts[1] ?? DEFAULT_MODEL_COLOR[1]),
        Number(parts[2] ?? DEFAULT_MODEL_COLOR[2]),
        material.baseColor[3],
      ];
    } else if (keyword === 'd' && parts[0] !== undefined) {
      material.baseColor = [material.baseColor[0], material.baseColor[1], material.baseColor[2], Number(parts[0])];
    } else if (keyword === 'tr' && parts[0] !== undefined) {
      material.baseColor = [material.baseColor[0], material.baseColor[1], material.baseColor[2], 1 - Number(parts[0])];
    } else if (keyword === 'map_kd') {
      material.mapKd = parseTexturePath(parts.join(' '));
    }
  }

  for (const material of materials.values()) {
    if (!material.mapKd) continue;
    try {
      const textureUrl = resolveModelSiblingUrl(mtlUrl, material.mapKd);
      if (!textureUrl) continue;
      const fetched = await fetchModelBytes(textureUrl);
      const texture = fetched
        ? await createTextureFromBytes(fetched.bytes, fetched.contentType)
        : null;
      if (texture) {
        material.baseColorTexture = texture;
        material.unlit = true;
      }
    } catch {
      // Missing sidecar textures should not prevent geometry from loading.
    }
  }

  return materials;
}

export async function resolveObjMaterials(text: string, objUrl: string): Promise<Map<string, ObjMaterialRuntime>> {
  const materials = new Map<string, ObjMaterialRuntime>();
  for (const libraryName of parseObjMaterialLibraries(text)) {
    try {
      const mtlUrl = resolveModelSiblingUrl(objUrl, libraryName);
      if (!mtlUrl) continue;
      const mtlText = await fetchModelText(mtlUrl);
      if (!mtlText) continue;
      for (const [name, material] of await resolveMtlMaterials(mtlText, mtlUrl)) {
        materials.set(name, material);
      }
    } catch {
      // OBJ geometry remains renderable without its material library.
    }
  }
  return materials;
}

export function parseObj(text: string, materials = new Map<string, ObjMaterialRuntime>()): PendingPrimitive[] {
  const positionsSource: Array<[number, number, number]> = [];
  const normalsSource: Array<[number, number, number]> = [];
  const texcoordsSource: Array<[number, number]> = [];
  const facesByMaterial = new Map<string, Array<Array<{
    positionIndex: number;
    texcoordIndex: number | null;
    normalIndex: number | null;
  }>>>();
  let currentMaterial = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'v' && parts.length >= 4) {
      positionsSource.push([
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 0),
      ]);
      continue;
    }

    if (keyword === 'vt' && parts.length >= 3) {
      texcoordsSource.push([
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
      ]);
      continue;
    }

    if (keyword === 'vn' && parts.length >= 4) {
      normalsSource.push(normalizeVector3(
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 1),
      ));
      continue;
    }

    if (keyword === 'usemtl') {
      currentMaterial = parts.slice(1).join(' ');
      if (!facesByMaterial.has(currentMaterial)) {
        facesByMaterial.set(currentMaterial, []);
      }
      continue;
    }

    if (keyword === 'f' && parts.length >= 4) {
      const face = parts.slice(1).map((entry) => {
        const [positionRaw, texcoordRaw, normalRaw] = entry.split('/');
        return {
          positionIndex: parseSignedIndex(positionRaw ?? '', positionsSource.length) ?? -1,
          texcoordIndex: texcoordRaw
            ? parseSignedIndex(texcoordRaw, texcoordsSource.length)
            : null,
          normalIndex: normalRaw
            ? parseSignedIndex(normalRaw, normalsSource.length)
            : null,
        };
      }).filter((entry) => entry.positionIndex >= 0);
      if (face.length >= 3) {
        const faces = facesByMaterial.get(currentMaterial) ?? [];
        faces.push(face);
        facesByMaterial.set(currentMaterial, faces);
      }
    }
  }

  if (facesByMaterial.size === 0) {
    return [];
  }

  const primitives: PendingPrimitive[] = [];

  for (const [materialName, faces] of facesByMaterial) {
    if (faces.length === 0) continue;
    const vertexMap = new Map<string, number>();
    const positions: number[] = [];
    const normals: number[] = [];
    const texcoords: number[] = [];
    const indices: number[] = [];
    let missingNormals = false;

    const getVertexIndex = (
      positionIndex: number,
      texcoordIndex: number | null,
      normalIndex: number | null,
    ): number => {
      const key = `${positionIndex}/${texcoordIndex ?? ''}/${normalIndex ?? ''}`;
      const cached = vertexMap.get(key);
      if (cached != null) {
        return cached;
      }

      const position = positionsSource[positionIndex] ?? [0, 0, 0];
      positions.push(position[0], position[1], position[2]);

      const texcoord = texcoordIndex != null ? texcoordsSource[texcoordIndex] : undefined;
      texcoords.push(texcoord?.[0] ?? 0, texcoord?.[1] ?? 0);

      if (normalIndex != null && normalsSource[normalIndex]) {
        const normal = normalsSource[normalIndex];
        normals.push(normal[0], normal[1], normal[2]);
      } else {
        normals.push(0, 0, 0);
        missingNormals = true;
      }

      const index = positions.length / 3 - 1;
      vertexMap.set(key, index);
      return index;
    };

    for (const face of faces) {
      for (let i = 1; i < face.length - 1; i += 1) {
        const tri = [face[0]!, face[i]!, face[i + 1]!];
        for (const vertex of tri) {
          indices.push(getVertexIndex(vertex.positionIndex, vertex.texcoordIndex, vertex.normalIndex));
        }
      }
    }

    const positionArray = new Float32Array(positions);
    const indexArray = new Uint32Array(indices);
    const normalArray = missingNormals
      ? computeNormals(positionArray, indexArray)
      : new Float32Array(normals);
    const material = materials.get(materialName);

    primitives.push({
      ...(materialName ? { name: materialName } : {}),
      positions: positionArray,
      normals: normalArray,
      texcoords: new Float32Array(texcoords),
      indices: indexArray,
      baseColor: material?.baseColor ?? DEFAULT_MODEL_COLOR,
      ...(material?.baseColorTexture ? { baseColorTexture: material.baseColorTexture } : {}),
      ...(material?.unlit ? { unlit: true } : {}),
    });
  }

  return primitives;
}
