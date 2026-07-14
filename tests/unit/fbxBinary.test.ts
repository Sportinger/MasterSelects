import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { parseFbx, parseFbxMeshNames } from '../../src/engine/native3d/assets/modelRuntimeCache/fbx';
import { isBinaryFbx, parseBinaryFbx } from '../../src/engine/native3d/assets/modelRuntimeCache/fbxBinary';

// Binary FBX object names are encoded as "Name<NUL><SOH>Class".
const NAME_SEPARATOR = String.fromCharCode(0, 1);

type TestProperty =
  | { type: 'L'; value: number }
  | { type: 'D'; value: number }
  | { type: 'S'; value: string }
  | { type: 'i'; value: number[]; compressed?: boolean }
  | { type: 'd'; value: number[]; compressed?: boolean };

interface TestNode {
  name: string;
  properties?: TestProperty[];
  children?: TestNode[];
}

const encoder = new TextEncoder();

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeArray(
  code: string,
  elementSize: number,
  writeElement: (view: DataView, offset: number, value: number) => void,
  values: number[],
  compressed: boolean,
): Uint8Array {
  const raw = new Uint8Array(values.length * elementSize);
  const rawView = new DataView(raw.buffer);
  values.forEach((value, index) => writeElement(rawView, index * elementSize, value));
  const payload = compressed ? zlibSync(raw) : raw;

  const header = new Uint8Array(13);
  header[0] = code.charCodeAt(0);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(1, values.length, true);
  headerView.setUint32(5, compressed ? 1 : 0, true);
  headerView.setUint32(9, payload.length, true);
  return concatBytes([header, payload]);
}

function encodeProperty(property: TestProperty): Uint8Array {
  switch (property.type) {
    case 'L': {
      const bytes = new Uint8Array(9);
      bytes[0] = 'L'.charCodeAt(0);
      new DataView(bytes.buffer).setBigInt64(1, BigInt(property.value), true);
      return bytes;
    }
    case 'D': {
      const bytes = new Uint8Array(9);
      bytes[0] = 'D'.charCodeAt(0);
      new DataView(bytes.buffer).setFloat64(1, property.value, true);
      return bytes;
    }
    case 'S': {
      const text = encoder.encode(property.value);
      const bytes = new Uint8Array(5 + text.length);
      bytes[0] = 'S'.charCodeAt(0);
      new DataView(bytes.buffer).setUint32(1, text.length, true);
      bytes.set(text, 5);
      return bytes;
    }
    case 'i':
      return encodeArray('i', 4, (view, offset, value) => view.setInt32(offset, value, true), property.value, property.compressed ?? false);
    case 'd':
      return encodeArray('d', 8, (view, offset, value) => view.setFloat64(offset, value, true), property.value, property.compressed ?? false);
  }
}

function encodeNode(node: TestNode, startOffset: number, wide: boolean): Uint8Array {
  const headerLength = (wide ? 24 : 12) + 1;
  const nameBytes = encoder.encode(node.name);
  const propertyBytes = concatBytes((node.properties ?? []).map(encodeProperty));
  const children = node.children ?? [];

  let childOffset = startOffset + headerLength + nameBytes.length + propertyBytes.length;
  const childParts: Uint8Array[] = [];
  for (const child of children) {
    const encoded = encodeNode(child, childOffset, wide);
    childParts.push(encoded);
    childOffset += encoded.length;
  }
  const terminator = children.length > 0 ? new Uint8Array(wide ? 25 : 13) : new Uint8Array(0);
  const endOffset = childOffset + terminator.length;

  const header = new Uint8Array(headerLength + nameBytes.length);
  const view = new DataView(header.buffer);
  if (wide) {
    view.setBigUint64(0, BigInt(endOffset), true);
    view.setBigUint64(8, BigInt((node.properties ?? []).length), true);
    view.setBigUint64(16, BigInt(propertyBytes.length), true);
    header[24] = nameBytes.length;
    header.set(nameBytes, 25);
  } else {
    view.setUint32(0, endOffset, true);
    view.setUint32(4, (node.properties ?? []).length, true);
    view.setUint32(8, propertyBytes.length, true);
    header[12] = nameBytes.length;
    header.set(nameBytes, 13);
  }
  return concatBytes([header, propertyBytes, ...childParts, terminator]);
}

function buildBinaryFbx(version: number, topLevel: TestNode[]): ArrayBuffer {
  const wide = version >= 7500;
  const header = new Uint8Array(27);
  header.set(encoder.encode('Kaydara FBX Binary  '), 0);
  header[21] = 0x1a;
  new DataView(header.buffer).setUint32(23, version, true);

  const parts: Uint8Array[] = [header];
  let offset = header.length;
  for (const node of topLevel) {
    const encoded = encodeNode(node, offset, wide);
    parts.push(encoded);
    offset += encoded.length;
  }
  parts.push(new Uint8Array(wide ? 25 : 13));
  return concatBytes(parts).buffer as ArrayBuffer;
}

function quadScene(version: number, compressed = false): ArrayBuffer {
  return buildBinaryFbx(version, [
    {
      name: 'Objects',
      children: [
        {
          name: 'Geometry',
          properties: [
            { type: 'L', value: 100 },
            { type: 'S', value: ['Quad', 'Geometry'].join(NAME_SEPARATOR) },
            { type: 'S', value: 'Mesh' },
          ],
          children: [
            { name: 'Vertices', properties: [{ type: 'd', value: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], compressed }] },
            { name: 'PolygonVertexIndex', properties: [{ type: 'i', value: [0, 1, 2, -4], compressed }] },
            {
              name: 'LayerElementUV',
              properties: [{ type: 'L', value: 0 }],
              children: [
                { name: 'MappingInformationType', properties: [{ type: 'S', value: 'ByPolygonVertex' }] },
                { name: 'ReferenceInformationType', properties: [{ type: 'S', value: 'IndexToDirect' }] },
                { name: 'UV', properties: [{ type: 'd', value: [0, 0, 1, 0, 1, 1, 0, 1] }] },
                { name: 'UVIndex', properties: [{ type: 'i', value: [0, 1, 2, 3] }] },
              ],
            },
          ],
        },
        {
          name: 'Model',
          properties: [
            { type: 'L', value: 200 },
            { type: 'S', value: ['QuadModel', 'Model'].join(NAME_SEPARATOR) },
            { type: 'S', value: 'Mesh' },
          ],
          children: [
            {
              name: 'Properties70',
              children: [
                {
                  name: 'P',
                  properties: [
                    { type: 'S', value: 'Lcl Translation' },
                    { type: 'S', value: 'Lcl Translation' },
                    { type: 'S', value: '' },
                    { type: 'S', value: 'A' },
                    { type: 'D', value: 10 },
                    { type: 'D', value: 20 },
                    { type: 'D', value: 30 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'Connections',
      children: [
        {
          name: 'C',
          properties: [
            { type: 'S', value: 'OO' },
            { type: 'L', value: 100 },
            { type: 'L', value: 200 },
          ],
        },
      ],
    },
  ]);
}

describe('fbxBinary', () => {
  it('detects the binary FBX magic header', () => {
    expect(isBinaryFbx(quadScene(7400))).toBe(true);
    expect(isBinaryFbx(encoder.encode('; FBX 6.1.0 project file').buffer as ArrayBuffer)).toBe(false);
  });

  it('parses a 32-bit binary FBX quad with UVs and model translation', () => {
    const primitives = parseBinaryFbx(quadScene(7400));

    expect(primitives).toHaveLength(1);
    const primitive = primitives[0]!;
    expect(primitive.name).toBe('Quad');
    expect(primitive.positions).toHaveLength(12);
    expect(Array.from(primitive.positions.slice(0, 3))).toEqual([10, 20, 30]);
    expect(Array.from(primitive.positions.slice(3, 6))).toEqual([11, 20, 30]);
    expect(primitive.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
    expect(primitive.texcoords).toHaveLength(8);
    expect(Array.from(primitive.texcoords?.slice(6, 8) ?? [])).toEqual([0, 1]);
    expect(primitive.normals).toHaveLength(12);
  });

  it('parses a 64-bit binary FBX with zlib-compressed arrays', () => {
    const primitives = parseBinaryFbx(quadScene(7500, true));

    expect(primitives).toHaveLength(1);
    expect(primitives[0]?.positions).toHaveLength(12);
    expect(primitives[0]?.indices).toEqual(new Uint32Array([0, 1, 2, 0, 2, 3]));
  });

  it('rejects headers with corrupted signature bytes', () => {
    const mutatedMarker = new Uint8Array(quadScene(7400).slice(0));
    mutatedMarker[21] = 0;
    expect(isBinaryFbx(mutatedMarker.buffer as ArrayBuffer)).toBe(false);

    const mutatedTerminator = new Uint8Array(quadScene(7400).slice(0));
    mutatedTerminator[22] = 7;
    expect(isBinaryFbx(mutatedTerminator.buffer as ArrayBuffer)).toBe(false);
  });

  it('returns no primitives for truncated binary files', () => {
    const scene = quadScene(7400);
    const truncated = scene.slice(0, Math.floor(scene.byteLength / 2));
    expect(parseBinaryFbx(truncated)).toEqual([]);
  });

  it('routes ASCII FBX buffers through the text parser', () => {
    const asciiFbx = [
      '; FBX 6.1.0 project file',
      'Objects:  {',
      '  Model: "Model::Tri", "Mesh" {',
      '    Vertices: 0,0,0, 1,0,0, 0,1,0',
      '    PolygonVertexIndex: 0,1,-3',
      '  }',
      '}',
    ].join('\n');
    const buffer = encoder.encode(asciiFbx).buffer as ArrayBuffer;

    expect(isBinaryFbx(buffer)).toBe(false);
    expect(parseFbx(buffer)).toHaveLength(1);
    expect(parseFbxMeshNames(buffer)).toEqual(['Tri']);
  });
});
