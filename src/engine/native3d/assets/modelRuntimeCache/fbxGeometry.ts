export interface FbxUvData {
  values: number[];
  indices: number[];
  mapping: string;
  reference: string;
}

export function transformPositions(
  positions: Float32Array,
  translation: readonly [number, number, number],
  scale: readonly [number, number, number],
): Float32Array {
  if (
    translation[0] === 0 && translation[1] === 0 && translation[2] === 0
    && scale[0] === 1 && scale[1] === 1 && scale[2] === 1
  ) {
    return positions;
  }

  const transformed = new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    transformed[index] = (positions[index] ?? 0) * scale[0] + translation[0];
    transformed[index + 1] = (positions[index + 1] ?? 0) * scale[1] + translation[1];
    transformed[index + 2] = (positions[index + 2] ?? 0) * scale[2] + translation[2];
  }
  return transformed;
}

function buildPolygonCorners(rawIndices: number[], vertexCount: number): Array<Array<{ controlPoint: number; polygonVertex: number }>> {
  const polygons: Array<Array<{ controlPoint: number; polygonVertex: number }>> = [];
  let polygon: Array<{ controlPoint: number; polygonVertex: number }> = [];
  let polygonVertex = 0;

  const flush = () => {
    const valid = polygon.filter(({ controlPoint }) => controlPoint >= 0 && controlPoint < vertexCount);
    if (valid.length >= 3) {
      polygons.push(valid);
    }
    polygon = [];
  };

  for (const rawIndex of rawIndices) {
    const controlPoint = rawIndex < 0 ? -rawIndex - 1 : rawIndex;
    polygon.push({ controlPoint, polygonVertex });
    if (rawIndex < 0) {
      flush();
    }
    polygonVertex += 1;
  }

  flush();
  return polygons;
}

function resolveUvIndex(
  uvData: FbxUvData,
  controlPoint: number,
  polygonVertex: number,
): number {
  const mappingIndex = /^byvert/i.test(uvData.mapping) ? controlPoint : polygonVertex;
  return /^index/i.test(uvData.reference)
    ? uvData.indices[mappingIndex] ?? mappingIndex
    : mappingIndex;
}

export function buildMeshGeometry(
  positionsByControlPoint: Float32Array,
  rawIndices: number[],
  uvData: FbxUvData | null,
): { positions: Float32Array; texcoords?: Float32Array; indices: Uint32Array } {
  const controlPointCount = Math.floor(positionsByControlPoint.length / 3);
  const polygons = buildPolygonCorners(rawIndices, controlPointCount);
  const positions: number[] = [];
  const texcoords: number[] = [];
  const indices: number[] = [];
  const vertexMap = new Map<string, number>();

  const getVertex = (controlPoint: number, polygonVertex: number): number => {
    const uvIndex = uvData ? resolveUvIndex(uvData, controlPoint, polygonVertex) : -1;
    const key = `${controlPoint}/${uvIndex}`;
    const cached = vertexMap.get(key);
    if (cached !== undefined) return cached;

    const positionOffset = controlPoint * 3;
    positions.push(
      positionsByControlPoint[positionOffset] ?? 0,
      positionsByControlPoint[positionOffset + 1] ?? 0,
      positionsByControlPoint[positionOffset + 2] ?? 0,
    );
    if (uvData && uvIndex >= 0) {
      const uvOffset = uvIndex * 2;
      texcoords.push(uvData.values[uvOffset] ?? 0, uvData.values[uvOffset + 1] ?? 0);
    } else {
      texcoords.push(0, 0);
    }

    const index = positions.length / 3 - 1;
    vertexMap.set(key, index);
    return index;
  };

  for (const polygon of polygons) {
    for (let i = 1; i < polygon.length - 1; i += 1) {
      const tri = [polygon[0]!, polygon[i]!, polygon[i + 1]!];
      for (const corner of tri) {
        indices.push(getVertex(corner.controlPoint, corner.polygonVertex));
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    ...(uvData ? { texcoords: new Float32Array(texcoords) } : {}),
    indices: new Uint32Array(indices),
  };
}
