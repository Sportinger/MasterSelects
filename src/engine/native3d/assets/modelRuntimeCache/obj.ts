import { computeNormals, normalizeVector3 } from './geometry';
import type { PendingPrimitive } from './types';
import { DEFAULT_MODEL_COLOR } from './types';

function parseSignedIndex(raw: string, total: number): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  return value > 0 ? value - 1 : total + value;
}

export function parseObj(text: string): PendingPrimitive[] {
  const positionsSource: Array<[number, number, number]> = [];
  const normalsSource: Array<[number, number, number]> = [];
  const faces: Array<Array<{ positionIndex: number; normalIndex: number | null }>> = [];

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

    if (keyword === 'vn' && parts.length >= 4) {
      normalsSource.push(normalizeVector3(
        Number(parts[1] ?? 0),
        Number(parts[2] ?? 0),
        Number(parts[3] ?? 1),
      ));
      continue;
    }

    if (keyword === 'f' && parts.length >= 4) {
      const face = parts.slice(1).map((entry) => {
        const [positionRaw, , normalRaw] = entry.split('/');
        return {
          positionIndex: parseSignedIndex(positionRaw ?? '', positionsSource.length) ?? -1,
          normalIndex: normalRaw
            ? parseSignedIndex(normalRaw, normalsSource.length)
            : null,
        };
      }).filter((entry) => entry.positionIndex >= 0);
      if (face.length >= 3) {
        faces.push(face);
      }
    }
  }

  if (faces.length === 0) {
    return [];
  }

  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let missingNormals = false;

  const getVertexIndex = (positionIndex: number, normalIndex: number | null): number => {
    const key = normalIndex == null ? `${positionIndex}` : `${positionIndex}/${normalIndex}`;
    const cached = vertexMap.get(key);
    if (cached != null) {
      return cached;
    }

    const position = positionsSource[positionIndex] ?? [0, 0, 0];
    positions.push(position[0], position[1], position[2]);

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
        indices.push(getVertexIndex(vertex.positionIndex, vertex.normalIndex));
      }
    }
  }

  const positionArray = new Float32Array(positions);
  const indexArray = new Uint32Array(indices);
  const normalArray = missingNormals
    ? computeNormals(positionArray, indexArray)
    : new Float32Array(normals);

  return [{
    positions: positionArray,
    normals: normalArray,
    indices: indexArray,
    baseColor: DEFAULT_MODEL_COLOR,
  }];
}
