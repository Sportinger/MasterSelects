// PLY format loader for Gaussian Splat data
//
// Parses binary PLY files with ASCII headers containing gaussian splat vertex data.
// Handles multiple property name variants and converts to canonical 14-float layout.

import { Logger } from '../../../services/logger.ts';
import type {
  GaussianSplatBuffer,
  GaussianSplatAsset,
  GaussianSplatMetadata,
  PlyHeaderInfo,
  PlyPropertyLayout,
} from './types.ts';
import { FLOATS_PER_SPLAT, SH_C0 } from './types.ts';
import { computeBoundingBox, sigmoid, normalizeQuaternion, buildMetadata } from './normalize.ts';

const log = Logger.create('PlyLoader');

// ── PLY data type sizes ──────────────────────────────────────────────────────

const PLY_TYPE_SIZES: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1,
  short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

// ── Property name aliases ────────────────────────────────────────────────────
// Maps canonical names to the set of accepted PLY property names

const PROPERTY_ALIASES: Record<string, string[]> = {
  // Position
  x: ['x', 'px'],
  y: ['y', 'py'],
  z: ['z', 'pz'],
  // Scale (raw — needs exp activation)
  scale_0: ['scale_0', 'sx'],
  scale_1: ['scale_1', 'sy'],
  scale_2: ['scale_2', 'sz'],
  // Rotation quaternion
  rot_0: ['rot_0', 'qw'],
  rot_1: ['rot_1', 'qx'],
  rot_2: ['rot_2', 'qy'],
  rot_3: ['rot_3', 'qz'],
  // Color DC (SH band-0 coefficients)
  f_dc_0: ['f_dc_0', 'red'],
  f_dc_1: ['f_dc_1', 'green'],
  f_dc_2: ['f_dc_2', 'blue'],
  // Opacity (raw — needs sigmoid)
  opacity: ['opacity', 'alpha'],
};

// ── Header parsing ───────────────────────────────────────────────────────────

/**
 * Parse the ASCII header of a PLY file from the beginning of a buffer.
 * Returns header metadata without reading the full payload.
 */
export function parsePlyHeader(headerBytes: Uint8Array): PlyHeaderInfo {
  // Decode header text (ASCII)
  const decoder = new TextDecoder('ascii');
  const text = decoder.decode(headerBytes);

  // Find end_header marker
  const endIdx = text.indexOf('end_header');
  if (endIdx === -1) {
    throw new Error('PLY header: missing end_header marker');
  }

  // Header byte length includes the newline after end_header
  const headerEndPos = text.indexOf('\n', endIdx);
  const headerByteLength = headerEndPos !== -1 ? headerEndPos + 1 : endIdx + 'end_header'.length + 1;

  const lines = text.substring(0, endIdx).split('\n').map(l => l.trim());

  // Validate magic
  if (!lines[0]?.startsWith('ply')) {
    throw new Error('PLY header: invalid magic — file does not start with "ply"');
  }

  // Check format
  const formatLine = lines.find(l => l.startsWith('format '));
  if (!formatLine) {
    throw new Error('PLY header: missing format declaration');
  }
  if (!formatLine.includes('binary_little_endian')) {
    throw new Error(`PLY header: unsupported format "${formatLine}". Only binary_little_endian is supported.`);
  }

  // Find vertex element
  let vertexCount = 0;
  let inVertexElement = false;
  const properties: PlyPropertyLayout[] = [];
  let currentOffset = 0;

  for (const line of lines) {
    if (line.startsWith('element vertex')) {
      const parts = line.split(/\s+/);
      vertexCount = parseInt(parts[2], 10);
      if (isNaN(vertexCount) || vertexCount < 0) {
        throw new Error(`PLY header: invalid vertex count "${parts[2]}"`);
      }
      inVertexElement = true;
      continue;
    }

    // Another element starts — stop collecting vertex properties
    if (line.startsWith('element ') && inVertexElement) {
      inVertexElement = false;
      continue;
    }

    if (inVertexElement && line.startsWith('property ')) {
      const parts = line.split(/\s+/);
      // property <type> <name>
      if (parts.length >= 3) {
        const type = parts[1];
        const name = parts[2];
        const size = PLY_TYPE_SIZES[type];
        if (size === undefined) {
          throw new Error(`PLY header: unknown property type "${type}" for property "${name}"`);
        }
        properties.push({ name, type, offset: currentOffset, size });
        currentOffset += size;
      }
    }
  }

  if (vertexCount === 0) {
    log.warn('PLY header: vertex count is 0');
  }

  // Detect SH data (look for f_rest_0 .. f_rest_N)
  const shRestProps = properties.filter(p => p.name.startsWith('f_rest_'));
  let shDegree = 0;
  let hasSphericalHarmonics = false;
  if (shRestProps.length > 0) {
    hasSphericalHarmonics = true;
    // SH rest count: degree 1 = 9 coeffs (3 channels * 3), degree 2 = 24, degree 3 = 45
    const restCount = shRestProps.length;
    if (restCount >= 45) shDegree = 3;
    else if (restCount >= 24) shDegree = 2;
    else if (restCount >= 9) shDegree = 1;
    else shDegree = 1;
  }

  return {
    vertexCount,
    headerByteLength,
    properties,
    perVertexByteStride: currentOffset,
    hasSphericalHarmonics,
    shDegree,
  };
}

// ── Property resolver ────────────────────────────────────────────────────────

interface ResolvedPropertyIndex {
  offset: number;
  size: number;
  type: string;
}

function resolveProperty(
  properties: PlyPropertyLayout[],
  canonicalName: string,
): ResolvedPropertyIndex | null {
  const aliases = PROPERTY_ALIASES[canonicalName];
  if (!aliases) return null;

  for (const alias of aliases) {
    const prop = properties.find(p => p.name === alias);
    if (prop) {
      return { offset: prop.offset, size: prop.size, type: prop.type };
    }
  }
  return null;
}

function readPropertyValue(dataView: DataView, byteOffset: number, prop: ResolvedPropertyIndex): number {
  switch (prop.type) {
    case 'float':
    case 'float32':
      return dataView.getFloat32(byteOffset + prop.offset, true);
    case 'double':
    case 'float64':
      return dataView.getFloat64(byteOffset + prop.offset, true);
    case 'uchar':
    case 'uint8':
      return dataView.getUint8(byteOffset + prop.offset);
    case 'char':
    case 'int8':
      return dataView.getInt8(byteOffset + prop.offset);
    case 'ushort':
    case 'uint16':
      return dataView.getUint16(byteOffset + prop.offset, true);
    case 'short':
    case 'int16':
      return dataView.getInt16(byteOffset + prop.offset, true);
    case 'uint':
    case 'uint32':
      return dataView.getUint32(byteOffset + prop.offset, true);
    case 'int':
    case 'int32':
      return dataView.getInt32(byteOffset + prop.offset, true);
    default:
      return 0;
  }
}

// ── Full loader ──────────────────────────────────────────────────────────────

/**
 * Parse a complete PLY file into a GaussianSplatAsset.
 */
export async function loadPly(file: File): Promise<GaussianSplatAsset> {
  const startTime = performance.now();
  log.info('Loading PLY file', { name: file.name, size: file.size });

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Parse header from first 64KB (should be more than enough for any header)
  const headerChunkSize = Math.min(bytes.length, 65536);
  const headerChunk = bytes.subarray(0, headerChunkSize);
  const header = parsePlyHeader(headerChunk);

  log.debug('PLY header parsed', {
    vertexCount: header.vertexCount,
    headerBytes: header.headerByteLength,
    stride: header.perVertexByteStride,
    properties: header.properties.length,
    shDegree: header.shDegree,
  });

  // Validate file size
  const expectedPayloadSize = header.vertexCount * header.perVertexByteStride;
  const actualPayloadSize = arrayBuffer.byteLength - header.headerByteLength;
  if (actualPayloadSize < expectedPayloadSize) {
    throw new Error(
      `PLY payload too small: expected ${expectedPayloadSize} bytes for ${header.vertexCount} vertices ` +
      `(stride ${header.perVertexByteStride}), but file has only ${actualPayloadSize} bytes after header`
    );
  }

  // Resolve properties
  const propX = resolveProperty(header.properties, 'x');
  const propY = resolveProperty(header.properties, 'y');
  const propZ = resolveProperty(header.properties, 'z');
  const propSx = resolveProperty(header.properties, 'scale_0');
  const propSy = resolveProperty(header.properties, 'scale_1');
  const propSz = resolveProperty(header.properties, 'scale_2');
  const propR0 = resolveProperty(header.properties, 'rot_0');
  const propR1 = resolveProperty(header.properties, 'rot_1');
  const propR2 = resolveProperty(header.properties, 'rot_2');
  const propR3 = resolveProperty(header.properties, 'rot_3');
  const propDc0 = resolveProperty(header.properties, 'f_dc_0');
  const propDc1 = resolveProperty(header.properties, 'f_dc_1');
  const propDc2 = resolveProperty(header.properties, 'f_dc_2');
  const propOpacity = resolveProperty(header.properties, 'opacity');

  // Position is required
  if (!propX || !propY || !propZ) {
    throw new Error('PLY: missing required position properties (x/y/z or px/py/pz)');
  }

  const splatCount = header.vertexCount;
  const data = new Float32Array(splatCount * FLOATS_PER_SPLAT);
  const dataView = new DataView(arrayBuffer, header.headerByteLength);
  const stride = header.perVertexByteStride;

  // Determine if color properties are u8 (direct RGB) vs float (SH DC)
  const colorIsDirect = propDc0 !== null && (propDc0.type === 'uchar' || propDc0.type === 'uint8');

  for (let i = 0; i < splatCount; i++) {
    const vertexOffset = i * stride;
    const outBase = i * FLOATS_PER_SPLAT;

    // Position
    data[outBase + 0] = readPropertyValue(dataView, vertexOffset, propX);
    data[outBase + 1] = readPropertyValue(dataView, vertexOffset, propY);
    data[outBase + 2] = readPropertyValue(dataView, vertexOffset, propZ);

    // Scale (exp-activated)
    if (propSx && propSy && propSz) {
      data[outBase + 3] = Math.exp(readPropertyValue(dataView, vertexOffset, propSx));
      data[outBase + 4] = Math.exp(readPropertyValue(dataView, vertexOffset, propSy));
      data[outBase + 5] = Math.exp(readPropertyValue(dataView, vertexOffset, propSz));
    } else {
      data[outBase + 3] = 1;
      data[outBase + 4] = 1;
      data[outBase + 5] = 1;
    }

    // Rotation (normalized quaternion)
    if (propR0 && propR1 && propR2 && propR3) {
      const rw = readPropertyValue(dataView, vertexOffset, propR0);
      const rx = readPropertyValue(dataView, vertexOffset, propR1);
      const ry = readPropertyValue(dataView, vertexOffset, propR2);
      const rz = readPropertyValue(dataView, vertexOffset, propR3);
      const [nw, nx, ny, nz] = normalizeQuaternion(rw, rx, ry, rz);
      data[outBase + 6] = nw;
      data[outBase + 7] = nx;
      data[outBase + 8] = ny;
      data[outBase + 9] = nz;
    } else {
      // Identity quaternion
      data[outBase + 6] = 1;
      data[outBase + 7] = 0;
      data[outBase + 8] = 0;
      data[outBase + 9] = 0;
    }

    // Color
    if (propDc0 && propDc1 && propDc2) {
      if (colorIsDirect) {
        // Direct u8 RGB [0-255] → [0,1]
        data[outBase + 10] = readPropertyValue(dataView, vertexOffset, propDc0) / 255;
        data[outBase + 11] = readPropertyValue(dataView, vertexOffset, propDc1) / 255;
        data[outBase + 12] = readPropertyValue(dataView, vertexOffset, propDc2) / 255;
      } else {
        // SH DC → RGB: color = 0.5 + SH_C0 * f_dc
        data[outBase + 10] = 0.5 + SH_C0 * readPropertyValue(dataView, vertexOffset, propDc0);
        data[outBase + 11] = 0.5 + SH_C0 * readPropertyValue(dataView, vertexOffset, propDc1);
        data[outBase + 12] = 0.5 + SH_C0 * readPropertyValue(dataView, vertexOffset, propDc2);
      }
    } else {
      // Default white
      data[outBase + 10] = 1;
      data[outBase + 11] = 1;
      data[outBase + 12] = 1;
    }

    // Opacity (sigmoid-activated)
    if (propOpacity) {
      const rawOpacity = readPropertyValue(dataView, vertexOffset, propOpacity);
      // If opacity is u8 [0-255], just normalize; otherwise apply sigmoid
      if (propOpacity.type === 'uchar' || propOpacity.type === 'uint8') {
        data[outBase + 13] = rawOpacity / 255;
      } else {
        data[outBase + 13] = sigmoid(rawOpacity);
      }
    } else {
      data[outBase + 13] = 1;
    }
  }

  // Extract SH rest data if present
  let shData: Float32Array | undefined;
  if (header.hasSphericalHarmonics) {
    const shRestProps = header.properties
      .filter(p => p.name.startsWith('f_rest_'))
      .toSorted((a, b) => {
        const aIdx = parseInt(a.name.replace('f_rest_', ''), 10);
        const bIdx = parseInt(b.name.replace('f_rest_', ''), 10);
        return aIdx - bIdx;
      });

    if (shRestProps.length > 0) {
      const shCoeffsPerSplat = shRestProps.length;
      shData = new Float32Array(splatCount * shCoeffsPerSplat);

      for (let i = 0; i < splatCount; i++) {
        const vertexOffset = i * stride;
        for (let j = 0; j < shCoeffsPerSplat; j++) {
          const prop = shRestProps[j];
          const resolved: ResolvedPropertyIndex = { offset: prop.offset, size: prop.size, type: prop.type };
          shData[i * shCoeffsPerSplat + j] = readPropertyValue(dataView, vertexOffset, resolved);
        }
      }
    }
  }

  const boundingBox = computeBoundingBox(data, splatCount);
  const metadata = buildMetadata(
    'ply',
    splatCount,
    boundingBox,
    file.size,
    header.hasSphericalHarmonics,
    header.shDegree,
  );

  const buffer: GaussianSplatBuffer = {
    data,
    splatCount,
    shData,
    shDegree: header.shDegree,
  };

  const elapsed = performance.now() - startTime;
  log.info('PLY loaded', {
    splatCount,
    shDegree: header.shDegree,
    bufferMB: (data.byteLength / (1024 * 1024)).toFixed(1),
    elapsedMs: elapsed.toFixed(0),
  });

  return {
    metadata,
    frames: [{ index: 0, buffer }],
    sourceFile: file,
    sourceUrl: '',
  };
}

/**
 * Parse only the PLY header for quick metadata extraction.
 * Reads at most 64KB from the file.
 */
export async function parsePlyHeaderOnly(file: File): Promise<GaussianSplatMetadata> {
  const chunkSize = Math.min(file.size, 65536);
  const slice = file.slice(0, chunkSize);
  const arrayBuffer = await slice.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const header = parsePlyHeader(bytes);

  // We can't compute a real bounding box without reading all data,
  // so return a zeroed one for header-only parse
  return buildMetadata(
    'ply',
    header.vertexCount,
    { min: [0, 0, 0], max: [0, 0, 0] },
    file.size,
    header.hasSphericalHarmonics,
    header.shDegree,
  );
}
