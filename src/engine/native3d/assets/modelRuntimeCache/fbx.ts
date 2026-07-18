import { isBinaryFbx, parseBinaryFbx } from './fbxBinary';
import { buildMeshGeometry, transformPositions } from './fbxGeometry';
import type { FbxUvData } from './fbxGeometry';
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

function readFbxUvData(block: string): FbxUvData | null {
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

export function parseFbx(buffer: ArrayBuffer): PendingPrimitive[] {
  return isBinaryFbx(buffer)
    ? parseBinaryFbx(buffer)
    : parseAsciiFbx(new TextDecoder().decode(buffer));
}

export function parseFbxMeshNames(buffer: ArrayBuffer): string[] {
  return parseFbx(buffer).map((primitive, index) => primitive.name || `Mesh ${index + 1}`);
}

export function parseAsciiFbxMeshNames(text: string): string[] {
  return parseAsciiFbx(text).map((primitive, index) => primitive.name || `Mesh ${index + 1}`);
}
