import type { BrushDatasetEntry } from './brushTrainingContract';

interface ColmapPoint {
  x: number;
  y: number;
  z: number;
  red: number;
  green: number;
  blue: number;
}

interface PlyProperty {
  name: string;
  offset: number;
  size: number;
  type: string;
}

export interface StabilizedBrushPly {
  bytes: Uint8Array;
  repairedValues: number;
  discardedSplats: number;
  vertexCount: number;
  normalizationScale: number;
}

const SH_C0 = 0.28209479177387814;
const HEADER_PROBE_BYTES = 64 * 1024;

function readUint64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x1_0000_0000;
}

function parseColmapPoints(buffer: ArrayBuffer): ColmapPoint[] {
  const view = new DataView(buffer);
  if (view.byteLength < 8) throw new Error('COLMAP points3D.bin is truncated.');
  const count = readUint64(view, 0);
  if (!Number.isSafeInteger(count) || count > 10_000_000) {
    throw new Error('COLMAP point count is invalid or too large.');
  }

  const points: ColmapPoint[] = [];
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    if (offset + 51 > view.byteLength) throw new Error('COLMAP points3D.bin ended unexpectedly.');
    offset += 8;
    const x = view.getFloat64(offset, true);
    const y = view.getFloat64(offset + 8, true);
    const z = view.getFloat64(offset + 16, true);
    offset += 24;
    const red = view.getUint8(offset);
    const green = view.getUint8(offset + 1);
    const blue = view.getUint8(offset + 2);
    offset += 3;
    offset += 8;
    const trackLength = readUint64(view, offset);
    offset += 8;
    const trackBytes = trackLength * 8;
    if (!Number.isSafeInteger(trackBytes) || offset + trackBytes > view.byteLength) {
      throw new Error('COLMAP points3D.bin contains an invalid observation track.');
    }
    offset += trackBytes;
    points.push({ x, y, z, red, green, blue });
  }
  return points;
}

function propertySize(type: string): number {
  if (['char', 'int8', 'uchar', 'uint8'].includes(type)) return 1;
  if (['short', 'int16', 'ushort', 'uint16'].includes(type)) return 2;
  if (['int', 'int32', 'uint', 'uint32', 'float', 'float32'].includes(type)) return 4;
  if (['double', 'float64'].includes(type)) return 8;
  throw new Error(`Unsupported PLY property type: ${type}.`);
}

function parsePlyLayout(bytes: Uint8Array): {
  headerBytes: number;
  properties: PlyProperty[];
  vertexCount: number;
  vertexStride: number;
} {
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, HEADER_PROBE_BYTES)));
  const endHeader = /end_header\r?\n/.exec(probe);
  if (!endHeader) throw new Error('Brush PLY header is incomplete.');
  const header = probe.slice(0, endHeader.index + endHeader[0].length);
  if (!/format binary_little_endian 1\.0/.test(header)) {
    throw new Error('Brush PLY must be binary little endian.');
  }

  let vertexCount = 0;
  let inVertexElement = false;
  let vertexStride = 0;
  const properties: PlyProperty[] = [];
  for (const line of header.split(/\r?\n/)) {
    const element = /^element (\S+) (\d+)$/.exec(line);
    if (element) {
      inVertexElement = element[1] === 'vertex';
      if (inVertexElement) vertexCount = Number(element[2]);
      continue;
    }
    const property = /^property (\S+) (\S+)$/.exec(line);
    if (!inVertexElement || !property) continue;
    const size = propertySize(property[1]);
    properties.push({ type: property[1], name: property[2], offset: vertexStride, size });
    vertexStride += size;
  }

  const headerBytes = new TextEncoder().encode(header).byteLength;
  if (vertexCount <= 0 || properties.length === 0 || headerBytes + vertexCount * vertexStride > bytes.byteLength) {
    throw new Error('Brush PLY vertex data is invalid.');
  }
  return { headerBytes, properties, vertexCount, vertexStride };
}

function requireFloatProperty(properties: PlyProperty[], name: string): PlyProperty {
  const property = properties.find((candidate) => candidate.name === name);
  if (!property || !['float', 'float32'].includes(property.type)) {
    throw new Error(`Brush PLY float property ${name} is missing.`);
  }
  return property;
}

function rgbToSh(value: number): number {
  return (value / 255 - 0.5) / SH_C0;
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))));
  return sorted[index];
}

export function stabilizeBrushPly(bytes: Uint8Array, colmapPointsBuffer: ArrayBuffer): StabilizedBrushPly {
  const points = parseColmapPoints(colmapPointsBuffer);
  const layout = parsePlyLayout(bytes);
  // Before the first refinement Brush preserves a one-to-one mapping with the
  // COLMAP points. Densification and pruning deliberately break that mapping,
  // so COLMAP values are only safe as per-row fallbacks while counts match.
  const matchingPoints = points.length === layout.vertexCount ? points : null;

  const output = bytes.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const x = requireFloatProperty(layout.properties, 'x');
  const y = requireFloatProperty(layout.properties, 'y');
  const z = requireFloatProperty(layout.properties, 'z');
  const dc = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map((name) => requireFloatProperty(layout.properties, name));
  const opacity = requireFloatProperty(layout.properties, 'opacity');
  const scales = ['scale_0', 'scale_1', 'scale_2'].map((name) => requireFloatProperty(layout.properties, name));
  const rotations = ['rot_0', 'rot_1', 'rot_2', 'rot_3'].map((name) => requireFloatProperty(layout.properties, name));
  let repairedValues = 0;
  let discardedSplats = 0;
  const discarded = new Uint8Array(layout.vertexCount);

  const setIfInvalid = (base: number, property: PlyProperty, fallback: number): boolean => {
    const offset = base + property.offset;
    if (Number.isFinite(view.getFloat32(offset, true))) return false;
    view.setFloat32(offset, fallback, true);
    repairedValues += 1;
    return true;
  };

  const discard = (index: number, base: number) => {
    if (discarded[index]) return;
    discarded[index] = 1;
    discardedSplats += 1;
    view.setFloat32(base + opacity.offset, -100, true);
  };

  for (let index = 0; index < layout.vertexCount; index += 1) {
    const base = layout.headerBytes + index * layout.vertexStride;
    const point = matchingPoints?.[index];
    const invalidPosition = [x, y, z].map((property, axis) => setIfInvalid(
      base,
      property,
      point ? [point.x, point.y, point.z][axis] : 0,
    )).some(Boolean);
    setIfInvalid(base, dc[0], point ? rgbToSh(point.red) : 0);
    setIfInvalid(base, dc[1], point ? rgbToSh(point.green) : 0);
    setIfInvalid(base, dc[2], point ? rgbToSh(point.blue) : 0);
    const invalidOpacity = setIfInvalid(base, opacity, point ? 0 : -100);
    const invalidScale = scales.map((property) => setIfInvalid(base, property, -4)).some(Boolean);
    if (!point && (invalidPosition || invalidOpacity || invalidScale)) discard(index, base);

    const rotationValues = rotations.map((property) => view.getFloat32(base + property.offset, true));
    const norm = Math.hypot(...rotationValues);
    if (!rotationValues.every(Number.isFinite) || !Number.isFinite(norm) || norm < 1e-8) {
      rotations.forEach((property, component) => {
        view.setFloat32(base + property.offset, component === 0 ? 1 : 0, true);
        repairedValues += 1;
      });
    }

    for (const property of layout.properties) {
      if (!['float', 'float32'].includes(property.type)) continue;
      setIfInvalid(base, property, 0);
    }
  }

  const positionProperties = [x, y, z];
  const axes = [[], [], []] as number[][];
  const maxLogScales: number[] = [];
  for (let index = 0; index < layout.vertexCount; index += 1) {
    const base = layout.headerBytes + index * layout.vertexStride;
    positionProperties.forEach((property, axis) => {
      axes[axis].push(view.getFloat32(base + property.offset, true));
    });
    maxLogScales.push(Math.max(...scales.map((property) => view.getFloat32(base + property.offset, true))));
  }
  axes.forEach((values) => values.sort((a, b) => a - b));
  const sortedScales = maxLogScales.toSorted((a, b) => a - b);
  const tail = layout.vertexCount >= 200 ? 0.005 : 0;
  const robustMin = axes.map((values) => quantile(values, tail));
  const robustMax = axes.map((values) => quantile(values, 1 - tail));
  const robustExtent = Math.max(...robustMax.map((value, axis) => value - robustMin[axis]), 1e-6);
  const scaleOutlierThreshold = Math.max(
    quantile(sortedScales, 0.99) + 2,
    quantile(sortedScales, 0.5) + 6,
  );

  for (let index = 0; index < layout.vertexCount; index += 1) {
    const base = layout.headerBytes + index * layout.vertexStride;
    const positionOutlier = positionProperties.some((property, axis) => {
      const value = view.getFloat32(base + property.offset, true);
      return value < robustMin[axis] - robustExtent * 2 || value > robustMax[axis] + robustExtent * 2;
    });
    if (positionOutlier || maxLogScales[index] > scaleOutlierThreshold) discard(index, base);
  }

  const center = robustMin.map((value, axis) => (value + robustMax[axis]) * 0.5);
  const largestExtent = robustExtent;
  const normalizationScale = largestExtent > 1e-6 ? 2 / largestExtent : 1;
  const logNormalizationScale = Math.log(normalizationScale);
  for (let index = 0; index < layout.vertexCount; index += 1) {
    const base = layout.headerBytes + index * layout.vertexStride;
    positionProperties.forEach((property, axis) => {
      const value = view.getFloat32(base + property.offset, true);
      view.setFloat32(
        base + property.offset,
        (value - center[axis]) * normalizationScale - (axis === 2 ? 2 : 0),
        true,
      );
    });
    scales.forEach((property) => {
      const offset = base + property.offset;
      view.setFloat32(offset, view.getFloat32(offset, true) + logNormalizationScale, true);
    });
  }

  return {
    bytes: output,
    repairedValues,
    discardedSplats,
    vertexCount: layout.vertexCount,
    normalizationScale,
  };
}

export async function readColmapPointsForBrush(entries: BrushDatasetEntry[]): Promise<ArrayBuffer | null> {
  const entry = entries.find(({ path }) => /(?:^|\/)sparse\/(?:0\/)?points3D\.bin$/i.test(path));
  return entry ? entry.file.arrayBuffer() : null;
}
