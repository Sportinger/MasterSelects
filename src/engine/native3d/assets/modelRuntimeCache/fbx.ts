import { computeNormals } from './geometry';
import type { PendingPrimitive } from './types';
import { DEFAULT_MODEL_COLOR } from './types';

interface FbxBlock {
  content: string;
  name?: string;
}

function parseNumbers(raw: string): number[] {
  return [...raw.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatchingBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function readBlockName(header: string): string | undefined {
  const match = /"(?:Geometry|Model)::([^"]+)"/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function findBlocks(text: string, label: string): FbxBlock[] {
  const blocks: FbxBlock[] = [];
  const blockPattern = new RegExp(`(^|\\n)[ \\t]*${label.replace(':', '')}\\s*:`, 'g');
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text))) {
    const labelIndex = match.index + (match[1]?.length ?? 0);

    const openIndex = text.indexOf('{', labelIndex);
    if (openIndex < 0) break;
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex < 0) break;

    blocks.push({
      content: text.slice(openIndex + 1, closeIndex),
      name: readBlockName(text.slice(labelIndex, openIndex)),
    });
    blockPattern.lastIndex = closeIndex + 1;
  }
  return blocks;
}

function findNextPropertyStart(block: string, startIndex: number): number {
  const propertyPattern = /\n[ \t]*[A-Za-z_][A-Za-z0-9_ ]*\s*:/g;
  propertyPattern.lastIndex = startIndex;
  const match = propertyPattern.exec(block);
  return match ? match.index + 1 : -1;
}

function readArray(block: string, name: string): number[] {
  const nameIndex = block.search(new RegExp(`${escapeRegExp(name)}\\s*:`, 'i'));
  if (nameIndex < 0) return [];

  const colonIndex = block.indexOf(':', nameIndex);
  const valueStart = colonIndex + 1;
  const nextPropertyIndex = findNextPropertyStart(block, valueStart);
  const openIndex = block.indexOf('{', valueStart);
  if (openIndex < 0 || (nextPropertyIndex >= 0 && openIndex > nextPropertyIndex)) {
    return parseNumbers(block.slice(valueStart, nextPropertyIndex < 0 ? undefined : nextPropertyIndex));
  }

  const closeIndex = findMatchingBrace(block, openIndex);
  if (closeIndex < 0) return [];

  const content = block.slice(openIndex + 1, closeIndex);
  const arrayMatch = /a\s*:/i.exec(content);
  return parseNumbers(arrayMatch ? content.slice(arrayMatch.index + arrayMatch[0].length) : content);
}

function readPropertyVector(block: string, name: string, fallback: readonly [number, number, number]): [number, number, number] {
  const propertyPattern = new RegExp(`Property\\s*:\\s*"${escapeRegExp(name)}"[^\\n]*`, 'i');
  const match = propertyPattern.exec(block);
  if (!match) return [fallback[0], fallback[1], fallback[2]];

  const valueStart = match[0].lastIndexOf('",');
  const values = parseNumbers(valueStart >= 0 ? match[0].slice(valueStart + 2) : match[0]);
  return [
    values[0] ?? fallback[0],
    values[1] ?? fallback[1],
    values[2] ?? fallback[2],
  ];
}

function readQuotedProperty(block: string, name: string): string | undefined {
  const pattern = new RegExp(`${escapeRegExp(name)}\\s*:\\s*"([^"]+)"`, 'i');
  return pattern.exec(block)?.[1];
}

function transformPositions(
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

function readFbxUvData(block: string): {
  values: number[];
  indices: number[];
  mapping: string;
  reference: string;
} | null {
  const uvBlock = findBlocks(block, 'LayerElementUV:')[0]?.content;
  if (!uvBlock) return null;
  const values = readArray(uvBlock, 'UV');
  if (values.length < 2) return null;
  return {
    values,
    indices: readArray(uvBlock, 'UVIndex'),
    mapping: readQuotedProperty(uvBlock, 'MappingInformationType') ?? 'ByPolygonVertex',
    reference: readQuotedProperty(uvBlock, 'ReferenceInformationType') ?? 'IndexToDirect',
  };
}

function resolveUvIndex(
  uvData: NonNullable<ReturnType<typeof readFbxUvData>>,
  controlPoint: number,
  polygonVertex: number,
): number {
  const mappingIndex = /^byvert/i.test(uvData.mapping) ? controlPoint : polygonVertex;
  return /^index/i.test(uvData.reference)
    ? uvData.indices[mappingIndex] ?? mappingIndex
    : mappingIndex;
}

function buildMeshGeometry(
  positionsByControlPoint: Float32Array,
  rawIndices: number[],
  uvData: ReturnType<typeof readFbxUvData>,
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

export function parseAsciiFbx(text: string): PendingPrimitive[] {
  if (!/FBX\s+\d/i.test(text)) return [];

  const primitives: PendingPrimitive[] = [];
  for (const block of [...findBlocks(text, 'Geometry:'), ...findBlocks(text, 'Model:')]) {
    const rawPositions = new Float32Array(readArray(block.content, 'Vertices'));
    const positions = transformPositions(
      rawPositions,
      readPropertyVector(block.content, 'Lcl Translation', [0, 0, 0]),
      readPropertyVector(block.content, 'Lcl Scaling', [1, 1, 1]),
    );
    const geometry = buildMeshGeometry(
      positions,
      readArray(block.content, 'PolygonVertexIndex'),
      readFbxUvData(block.content),
    );
    if (geometry.positions.length === 0 || geometry.indices.length === 0) continue;

    primitives.push({
      name: block.name,
      positions: geometry.positions,
      normals: computeNormals(geometry.positions, geometry.indices),
      texcoords: geometry.texcoords,
      indices: geometry.indices,
      baseColor: DEFAULT_MODEL_COLOR,
    });
  }
  return primitives;
}

export function parseAsciiFbxMeshNames(text: string): string[] {
  return parseAsciiFbx(text).map((primitive, index) => primitive.name || `Mesh ${index + 1}`);
}
