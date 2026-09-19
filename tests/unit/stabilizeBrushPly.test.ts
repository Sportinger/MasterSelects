import { describe, expect, it } from 'vitest';
import { stabilizeBrushPly } from '../../src/services/photogrammetry/stabilizeBrushPly';

const properties = [
  'x', 'y', 'z',
  'f_dc_0', 'f_dc_1', 'f_dc_2',
  'f_rest_0', 'opacity',
  'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

function createPly(vertexCount = 1, initialValue = Number.NaN): Uint8Array {
  const header = new TextEncoder().encode([
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    ...properties.map((name) => `property float ${name}`),
    'end_header',
    '',
  ].join('\n'));
  const bytes = new Uint8Array(header.byteLength + properties.length * 4 * vertexCount);
  bytes.set(header);
  const view = new DataView(bytes.buffer);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    properties.forEach((_, index) => {
      view.setFloat32(header.byteLength + (vertex * properties.length + index) * 4, initialValue, true);
    });
  }
  return bytes;
}

function createColmapPoint(): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + 51);
  const view = new DataView(buffer);
  view.setUint32(0, 1, true);
  view.setUint32(8, 7, true);
  view.setFloat64(16, 1, true);
  view.setFloat64(24, 2, true);
  view.setFloat64(32, 3, true);
  view.setUint8(40, 255);
  view.setUint8(41, 128);
  view.setUint8(42, 0);
  view.setFloat64(43, 0.1, true);
  return buffer;
}

describe('stabilizeBrushPly', () => {
  it('repairs non-finite Gaussian values from the matching COLMAP point', () => {
    const repaired = stabilizeBrushPly(createPly(), createColmapPoint());
    const headerText = new TextDecoder().decode(repaired.bytes);
    const headerBytes = headerText.indexOf('end_header\n') + 'end_header\n'.length;
    const view = new DataView(repaired.bytes.buffer, repaired.bytes.byteOffset, repaired.bytes.byteLength);
    const value = (name: string) => view.getFloat32(headerBytes + properties.indexOf(name) * 4, true);

    expect(repaired.vertexCount).toBe(1);
    expect(repaired.repairedValues).toBeGreaterThan(0);
    expect([value('x'), value('y'), value('z')]).toEqual([0, 0, -2]);
    expect(value('f_dc_0')).toBeCloseTo((1 - 0.5) / 0.28209479177387814);
    expect(value('opacity')).toBe(0);
    expect([value('scale_0'), value('scale_1'), value('scale_2')]).toEqual([-4, -4, -4]);
    expect([value('rot_0'), value('rot_1'), value('rot_2'), value('rot_3')]).toEqual([1, 0, 0, 0]);
    expect(value('f_rest_0')).toBe(0);
  });

  it('stabilizes densified output without assuming a COLMAP row mapping', () => {
    const repaired = stabilizeBrushPly(createPly(2, 0), createColmapPoint());

    expect(repaired.vertexCount).toBe(2);
    expect(repaired.discardedSplats).toBe(0);
    expect(repaired.normalizationScale).toBe(1);
  });
});
