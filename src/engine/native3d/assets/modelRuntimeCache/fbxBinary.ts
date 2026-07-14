import { unzlibSync } from 'fflate';
import { buildMeshGeometry, transformPositions } from './fbxGeometry';
import type { FbxUvData } from './fbxGeometry';
import { computeNormals } from './geometry';
import type { PendingPrimitive } from './types';
import { DEFAULT_MODEL_COLOR } from './types';

const BINARY_FBX_MAGIC = 'Kaydara FBX Binary  ';
const BINARY_FBX_HEADER_LENGTH = 27;
const WIDE_OFFSET_VERSION = 7500;
// Binary FBX object names are encoded as "Name<NUL><SOH>Class".
const FBX_NAME_SEPARATOR = String.fromCharCode(0, 1);

type FbxPropertyValue = number | boolean | string | number[] | Uint8Array;

interface FbxNode {
  name: string;
  properties: FbxPropertyValue[];
  children: FbxNode[];
}

interface FbxCursor {
  view: DataView;
  bytes: Uint8Array;
  offset: number;
  wide: boolean;
}

const textDecoder = new TextDecoder();

export function isBinaryFbx(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < BINARY_FBX_HEADER_LENGTH) return false;
  const bytes = new Uint8Array(buffer, 0, BINARY_FBX_MAGIC.length + 3);
  for (let index = 0; index < BINARY_FBX_MAGIC.length; index += 1) {
    if (bytes[index] !== BINARY_FBX_MAGIC.charCodeAt(index)) return false;
  }
  return bytes[20] === 0 && bytes[21] === 0x1a && bytes[22] === 0;
}

function readRecordLength(cursor: FbxCursor): number {
  if (cursor.wide) {
    const value = Number(cursor.view.getBigUint64(cursor.offset, true));
    cursor.offset += 8;
    return value;
  }
  const value = cursor.view.getUint32(cursor.offset, true);
  cursor.offset += 4;
  return value;
}

function readString(cursor: FbxCursor, length: number): string {
  const value = textDecoder.decode(cursor.bytes.subarray(cursor.offset, cursor.offset + length));
  cursor.offset += length;
  return value;
}

function readNumberArray(
  cursor: FbxCursor,
  elementSize: number,
  readElement: (view: DataView, offset: number) => number,
): number[] {
  const arrayLength = cursor.view.getUint32(cursor.offset, true);
  const encoding = cursor.view.getUint32(cursor.offset + 4, true);
  const compressedLength = cursor.view.getUint32(cursor.offset + 8, true);
  cursor.offset += 12;

  let view: DataView;
  if (encoding === 0) {
    const byteLength = arrayLength * elementSize;
    view = new DataView(cursor.bytes.buffer, cursor.bytes.byteOffset + cursor.offset, byteLength);
    cursor.offset += byteLength;
  } else {
    const inflated = unzlibSync(cursor.bytes.subarray(cursor.offset, cursor.offset + compressedLength));
    view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    cursor.offset += compressedLength;
  }

  const values = new Array<number>(arrayLength);
  for (let index = 0; index < arrayLength; index += 1) {
    values[index] = readElement(view, index * elementSize);
  }
  return values;
}

function readProperty(cursor: FbxCursor): FbxPropertyValue {
  const typeCode = String.fromCharCode(cursor.bytes[cursor.offset] ?? 0);
  cursor.offset += 1;

  switch (typeCode) {
    case 'C': {
      const value = (cursor.bytes[cursor.offset] ?? 0) !== 0;
      cursor.offset += 1;
      return value;
    }
    case 'Y': {
      const value = cursor.view.getInt16(cursor.offset, true);
      cursor.offset += 2;
      return value;
    }
    case 'I': {
      const value = cursor.view.getInt32(cursor.offset, true);
      cursor.offset += 4;
      return value;
    }
    case 'F': {
      const value = cursor.view.getFloat32(cursor.offset, true);
      cursor.offset += 4;
      return value;
    }
    case 'D': {
      const value = cursor.view.getFloat64(cursor.offset, true);
      cursor.offset += 8;
      return value;
    }
    case 'L': {
      const raw = cursor.view.getBigInt64(cursor.offset, true);
      cursor.offset += 8;
      // Object ids are int64; keep values beyond 2^53 as strings so map keys stay exact.
      const value = Number(raw);
      return Number.isSafeInteger(value) ? value : raw.toString();
    }
    case 'b': return readNumberArray(cursor, 1, (view, offset) => view.getUint8(offset));
    case 'i': return readNumberArray(cursor, 4, (view, offset) => view.getInt32(offset, true));
    case 'l': return readNumberArray(cursor, 8, (view, offset) => Number(view.getBigInt64(offset, true)));
    case 'f': return readNumberArray(cursor, 4, (view, offset) => view.getFloat32(offset, true));
    case 'd': return readNumberArray(cursor, 8, (view, offset) => view.getFloat64(offset, true));
    case 'S': {
      const length = cursor.view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      return readString(cursor, length);
    }
    case 'R': {
      const length = cursor.view.getUint32(cursor.offset, true);
      cursor.offset += 4;
      const value = cursor.bytes.slice(cursor.offset, cursor.offset + length);
      cursor.offset += length;
      return value;
    }
    default:
      throw new Error(`Unsupported binary FBX property type "${typeCode}"`);
  }
}

function readNode(cursor: FbxCursor, limit: number): FbxNode | null {
  const recordStart = cursor.offset;
  const endOffset = readRecordLength(cursor);
  const propertyCount = readRecordLength(cursor);
  const propertyListLength = readRecordLength(cursor);
  const nameLength = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;

  if (endOffset === 0 && propertyCount === 0 && propertyListLength === 0 && nameLength === 0) {
    return null;
  }
  if (endOffset <= recordStart || endOffset > limit) {
    throw new Error('Malformed binary FBX node record');
  }

  const name = readString(cursor, nameLength);
  const propertiesEnd = cursor.offset + propertyListLength;
  if (propertiesEnd > endOffset) {
    throw new Error('Malformed binary FBX property list');
  }
  const properties: FbxPropertyValue[] = [];
  for (let index = 0; index < propertyCount; index += 1) {
    properties.push(readProperty(cursor));
  }
  if (cursor.offset !== propertiesEnd) {
    throw new Error('Malformed binary FBX property list');
  }

  const children: FbxNode[] = [];
  while (cursor.offset < endOffset) {
    const child = readNode(cursor, endOffset);
    if (!child) break;
    children.push(child);
  }
  if (cursor.offset > endOffset) {
    throw new Error('Malformed binary FBX node record');
  }
  cursor.offset = endOffset;

  return { name, properties, children };
}

function parseNodeTree(buffer: ArrayBuffer): FbxNode[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const version = view.getUint32(23, true);
  const cursor: FbxCursor = {
    view,
    bytes,
    offset: BINARY_FBX_HEADER_LENGTH,
    wide: version >= WIDE_OFFSET_VERSION,
  };

  const nodes: FbxNode[] = [];
  const minimumRecordLength = cursor.wide ? 25 : 13;
  while (cursor.offset + minimumRecordLength <= bytes.length) {
    const node = readNode(cursor, bytes.length);
    if (!node) break;
    nodes.push(node);
  }
  return nodes;
}

type FbxObjectId = number | string;

function toObjectId(value: FbxPropertyValue | undefined): FbxObjectId | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  return null;
}

function findChild(nodes: FbxNode[], name: string): FbxNode | undefined {
  return nodes.find((node) => node.name === name);
}

function findChildren(nodes: FbxNode[], name: string): FbxNode[] {
  return nodes.filter((node) => node.name === name);
}

function objectName(node: FbxNode): string | undefined {
  const raw = node.properties.find((property): property is string => typeof property === 'string');
  if (!raw) return undefined;
  const name = raw.split(FBX_NAME_SEPARATOR)[0]?.trim();
  return name || undefined;
}

function objectId(node: FbxNode): FbxObjectId | null {
  return toObjectId(node.properties[0]);
}

function numberArrayProperty(node: FbxNode | undefined): number[] {
  const value = node?.properties[0];
  if (Array.isArray(value)) return value;
  return node ? node.properties.filter((property): property is number => typeof property === 'number') : [];
}

function stringProperty(node: FbxNode | undefined): string | undefined {
  const value = node?.properties[0];
  return typeof value === 'string' ? value : undefined;
}

function readVectorProperty(
  node: FbxNode,
  propertyName: string,
  fallback: readonly [number, number, number],
): readonly [number, number, number] {
  const container = findChild(node.children, 'Properties70') ?? findChild(node.children, 'Properties60');
  if (!container) return fallback;

  const entries = [...findChildren(container.children, 'P'), ...findChildren(container.children, 'Property')];
  for (const entry of entries) {
    if (entry.properties[0] !== propertyName) continue;
    const numbers = entry.properties.filter((value): value is number => typeof value === 'number');
    if (numbers.length < 3) return fallback;
    return [
      numbers[numbers.length - 3] ?? fallback[0],
      numbers[numbers.length - 2] ?? fallback[1],
      numbers[numbers.length - 1] ?? fallback[2],
    ];
  }
  return fallback;
}

function readUvData(source: FbxNode): FbxUvData | null {
  const uvNode = findChild(source.children, 'LayerElementUV');
  if (!uvNode) return null;
  const values = numberArrayProperty(findChild(uvNode.children, 'UV'));
  if (values.length < 2) return null;
  return {
    values,
    indices: numberArrayProperty(findChild(uvNode.children, 'UVIndex')),
    mapping: stringProperty(findChild(uvNode.children, 'MappingInformationType')) ?? 'ByPolygonVertex',
    reference: stringProperty(findChild(uvNode.children, 'ReferenceInformationType')) ?? 'IndexToDirect',
  };
}

function buildParentByChild(nodes: FbxNode[]): Map<FbxObjectId, FbxObjectId> {
  const map = new Map<FbxObjectId, FbxObjectId>();
  const connections = findChild(nodes, 'Connections');
  for (const connection of connections ? findChildren(connections.children, 'C') : []) {
    const [kind, child, parent] = connection.properties;
    const childId = toObjectId(child);
    const parentId = toObjectId(parent);
    if (kind === 'OO' && childId !== null && parentId !== null && !map.has(childId)) {
      map.set(childId, parentId);
    }
  }
  return map;
}

interface FbxModelInfo {
  name?: string;
  translation: readonly [number, number, number];
  scale: readonly [number, number, number];
}

function readModelInfo(model: FbxNode): FbxModelInfo {
  return {
    name: objectName(model),
    translation: readVectorProperty(model, 'Lcl Translation', [0, 0, 0]),
    scale: readVectorProperty(model, 'Lcl Scaling', [1, 1, 1]),
  };
}

export function parseBinaryFbx(buffer: ArrayBuffer): PendingPrimitive[] {
  if (!isBinaryFbx(buffer)) return [];

  let nodes: FbxNode[];
  try {
    nodes = parseNodeTree(buffer);
  } catch {
    return [];
  }

  const objects = findChild(nodes, 'Objects');
  if (!objects) return [];

  const parentByChild = buildParentByChild(nodes);
  const modelsById = new Map<FbxObjectId, FbxModelInfo>();
  for (const model of findChildren(objects.children, 'Model')) {
    const id = objectId(model);
    if (id !== null) {
      modelsById.set(id, readModelInfo(model));
    }
  }

  const geometries = findChildren(objects.children, 'Geometry');
  const meshSources = geometries.length > 0
    ? geometries
    : findChildren(objects.children, 'Model').filter((model) => findChild(model.children, 'Vertices'));

  const primitives: PendingPrimitive[] = [];
  for (const source of meshSources) {
    const vertices = numberArrayProperty(findChild(source.children, 'Vertices'));
    const rawIndices = numberArrayProperty(findChild(source.children, 'PolygonVertexIndex'));
    if (vertices.length < 9 || rawIndices.length < 3) continue;

    const sourceId = objectId(source);
    const parentId = sourceId !== null ? parentByChild.get(sourceId) : undefined;
    const model = source.name === 'Model'
      ? readModelInfo(source)
      : (parentId !== undefined ? modelsById.get(parentId) : undefined);

    const positions = transformPositions(
      new Float32Array(vertices),
      model?.translation ?? [0, 0, 0],
      model?.scale ?? [1, 1, 1],
    );
    const geometry = buildMeshGeometry(positions, rawIndices, readUvData(source));
    if (geometry.positions.length === 0 || geometry.indices.length === 0) continue;

    const name = objectName(source) ?? model?.name;
    primitives.push({
      ...(name ? { name } : {}),
      positions: geometry.positions,
      normals: computeNormals(geometry.positions, geometry.indices),
      ...(geometry.texcoords ? { texcoords: geometry.texcoords } : {}),
      indices: geometry.indices,
      baseColor: DEFAULT_MODEL_COLOR,
    });
  }
  return primitives;
}
