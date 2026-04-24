import {
  BufferedReadStream,
  Column,
  getInputFormat,
  readFile,
  ReadStream,
  sortMortonOrder,
  ZipReadFileSystem,
  type ColumnType,
  type DataTable,
  type InputFormat,
  type Options as SplatTransformOptions,
  type ReadFileSystem,
  type ReadSource,
} from '@playcanvas/splat-transform';

import type {
  GaussianSplatAsset,
  GaussianSplatBuffer,
  GaussianSplatFormat,
  GaussianSplatLoadOptions,
  GaussianSplatLoadProgressCallback,
} from './types.ts';
import { FLOATS_PER_SPLAT, SH_C0 } from './types.ts';
import { buildMetadata, computeBoundingBox, normalizeQuaternion, sigmoid } from './normalize.ts';

const BLOB_CHUNK_SIZE = 4 * 1024 * 1024;
type BlobReadProgressReporter = (loadedBytes: number, totalBytes: number) => void;

const DEFAULT_OPTIONS: SplatTransformOptions = {
  iterations: 10,
  lodSelect: [0],
  unbundled: false,
  lodChunkCount: 512,
  lodChunkExtent: 16,
};

const SUPPORTED_INPUT_FORMATS = new Set<InputFormat>([
  'ply',
  'splat',
  'ksplat',
  'spz',
  'sog',
  'lcc',
]);

class BlobReadStream extends ReadStream {
  private readonly blob: Blob;
  private readonly end: number;
  private readonly onReadProgress?: BlobReadProgressReporter;
  private offset: number;

  constructor(
    blob: Blob,
    start: number,
    end: number,
    onReadProgress?: BlobReadProgressReporter,
  ) {
    super(end - start);
    this.blob = blob;
    this.end = end;
    this.onReadProgress = onReadProgress;
    this.offset = start;
  }

  async pull(target: Uint8Array): Promise<number> {
    const remaining = this.end - this.offset;
    if (remaining <= 0) {
      return 0;
    }

    const bytesToRead = Math.min(target.length, remaining);
    const blobLike = this.blob as Blob & {
      slice?: Blob['slice'];
      arrayBuffer?: Blob['arrayBuffer'];
    };

    let bytes: Uint8Array;
    if (typeof blobLike.slice === 'function') {
      const slice = blobLike.slice(this.offset, this.offset + bytesToRead);
      if (typeof slice.arrayBuffer === 'function') {
        bytes = new Uint8Array(await slice.arrayBuffer());
      } else {
        bytes = new Uint8Array(await new Response(slice).arrayBuffer());
      }
    } else if (typeof blobLike.arrayBuffer === 'function') {
      const full = new Uint8Array(await blobLike.arrayBuffer());
      bytes = full.subarray(this.offset, this.offset + bytesToRead);
    } else {
      throw new Error('Blob source does not support slice() or arrayBuffer()');
    }

    target.set(bytes);
    this.offset += bytesToRead;
    this.bytesRead += bytesToRead;
    this.onReadProgress?.(this.offset, this.blob.size);
    return bytesToRead;
  }
}

class BlobReadSource implements ReadSource {
  readonly size: number;
  readonly seekable = true;
  private closed = false;
  private readonly blob: Blob;
  private readonly onProgress?: GaussianSplatLoadProgressCallback;
  private maxReadOffset = 0;

  constructor(blob: Blob, onProgress?: GaussianSplatLoadProgressCallback) {
    this.blob = blob;
    this.size = blob.size;
    this.onProgress = onProgress;
  }

  private reportReadProgress(loadedBytes: number, totalBytes: number): void {
    const nextLoadedBytes = Math.max(this.maxReadOffset, loadedBytes);
    if (nextLoadedBytes === this.maxReadOffset && this.maxReadOffset > 0) {
      return;
    }

    this.maxReadOffset = nextLoadedBytes;
    this.onProgress?.({
      phase: 'reading',
      loadedBytes: nextLoadedBytes,
      totalBytes,
      percent: totalBytes > 0 ? nextLoadedBytes / totalBytes : 0,
      message: 'Reading splat file',
    });
  }

  read(start = 0, end = this.size): ReadStream {
    if (this.closed) {
      throw new Error('Blob source has been closed');
    }

    const clampedStart = Math.max(0, Math.min(start, this.size));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.size));
    return new BufferedReadStream(
      new BlobReadStream(
        this.blob,
        clampedStart,
        clampedEnd,
        (loadedBytes, totalBytes) => this.reportReadProgress(loadedBytes, totalBytes),
      ),
      BLOB_CHUNK_SIZE,
    );
  }

  close(): void {
    this.closed = true;
  }
}

class BlobReadFileSystem implements ReadFileSystem {
  private readonly files = new Map<string, Blob>();
  private readonly onProgress?: GaussianSplatLoadProgressCallback;

  constructor(onProgress?: GaussianSplatLoadProgressCallback) {
    this.onProgress = onProgress;
  }

  set(name: string, blob: Blob): void {
    this.files.set(name.toLowerCase(), blob);
  }

  async createSource(filename: string): Promise<ReadSource> {
    const blob = this.files.get(filename.toLowerCase());
    if (!blob) {
      throw new Error(`File not found: ${filename}`);
    }
    return new BlobReadSource(blob, this.onProgress);
  }
}

function toSplatTransformInputFormat(format: GaussianSplatFormat): InputFormat | null {
  if (format === 'gsplat-zip') {
    return 'sog';
  }
  return SUPPORTED_INPUT_FORMATS.has(format as InputFormat) ? format as InputFormat : null;
}

function detectSplatTransformInputFormat(file: File, format?: GaussianSplatFormat): InputFormat | null {
  if (format) {
    return toSplatTransformInputFormat(format);
  }

  try {
    const inputFormat = getInputFormat(file.name);
    return SUPPORTED_INPUT_FORMATS.has(inputFormat) ? inputFormat : null;
  } catch {
    return null;
  }
}

function getRequiredColumn(table: DataTable, names: string[]): { data: ArrayLike<number>; type: ColumnType | null } {
  for (const name of names) {
    const column = table.getColumnByName(name);
    if (column) {
      return { data: column.data, type: column.dataType };
    }
  }

  throw new Error(`Missing required splat properties: ${names.join(' or ')}`);
}

function valueAt(column: ArrayLike<number>, index: number, fallback = 0): number {
  return column[index] ?? fallback;
}

function isU8Column(type: ColumnType | null): boolean {
  return type === 'uint8' || type === 'int8';
}

function ensureScaleZ(table: DataTable): void {
  if (table.hasColumn('scale_0') && table.hasColumn('scale_1') && !table.hasColumn('scale_2')) {
    table.addColumn(new Column('scale_2', new Float32Array(table.numRows).fill(Math.log(1e-6))));
  }
}

function sortTableByMortonOrder(table: DataTable): void {
  const indices = new Uint32Array(table.numRows);
  for (let i = 0; i < indices.length; i += 1) {
    indices[i] = i;
  }
  sortMortonOrder(table, indices);
  table.permuteRowsInPlace(indices);
}

function inferShDegree(shCoeffCount: number): number {
  if (shCoeffCount >= 45) return 3;
  if (shCoeffCount >= 24) return 2;
  if (shCoeffCount >= 9) return 1;
  return shCoeffCount > 0 ? 1 : 0;
}

function convertTableToAsset(
  table: DataTable,
  file: File,
  inputFormat: InputFormat,
): GaussianSplatAsset {
  ensureScaleZ(table);

  const splatCount = table.numRows;
  const data = new Float32Array(splatCount * FLOATS_PER_SPLAT);

  const x = getRequiredColumn(table, ['x', 'px']).data;
  const y = getRequiredColumn(table, ['y', 'py']).data;
  const z = getRequiredColumn(table, ['z', 'pz']).data;
  const scale0 = getRequiredColumn(table, ['scale_0', 'sx']).data;
  const scale1 = getRequiredColumn(table, ['scale_1', 'sy']).data;
  const scale2 = getRequiredColumn(table, ['scale_2', 'sz']).data;
  const rot0 = getRequiredColumn(table, ['rot_0', 'qw']).data;
  const rot1 = getRequiredColumn(table, ['rot_1', 'qx']).data;
  const rot2 = getRequiredColumn(table, ['rot_2', 'qy']).data;
  const rot3 = getRequiredColumn(table, ['rot_3', 'qz']).data;
  const dc0 = getRequiredColumn(table, ['f_dc_0', 'red']);
  const dc1 = getRequiredColumn(table, ['f_dc_1', 'green']);
  const dc2 = getRequiredColumn(table, ['f_dc_2', 'blue']);
  const opacity = getRequiredColumn(table, ['opacity', 'alpha']);
  const colorIsDirect = isU8Column(dc0.type) || dc0.data === table.getColumnByName('red')?.data;
  const opacityIsDirect = isU8Column(opacity.type) || opacity.data === table.getColumnByName('alpha')?.data;

  for (let i = 0; i < splatCount; i += 1) {
    const base = i * FLOATS_PER_SPLAT;
    data[base + 0] = valueAt(x, i);
    data[base + 1] = valueAt(y, i);
    data[base + 2] = valueAt(z, i);
    data[base + 3] = Math.exp(valueAt(scale0, i));
    data[base + 4] = Math.exp(valueAt(scale1, i));
    data[base + 5] = Math.exp(valueAt(scale2, i));

    const [rw, rx, ry, rz] = normalizeQuaternion(
      valueAt(rot0, i, 1),
      valueAt(rot1, i),
      valueAt(rot2, i),
      valueAt(rot3, i),
    );
    data[base + 6] = rw;
    data[base + 7] = rx;
    data[base + 8] = ry;
    data[base + 9] = rz;

    if (colorIsDirect) {
      data[base + 10] = valueAt(dc0.data, i) / 255;
      data[base + 11] = valueAt(dc1.data, i) / 255;
      data[base + 12] = valueAt(dc2.data, i) / 255;
    } else {
      data[base + 10] = 0.5 + SH_C0 * valueAt(dc0.data, i);
      data[base + 11] = 0.5 + SH_C0 * valueAt(dc1.data, i);
      data[base + 12] = 0.5 + SH_C0 * valueAt(dc2.data, i);
    }

    data[base + 13] = opacityIsDirect
      ? valueAt(opacity.data, i) / 255
      : sigmoid(valueAt(opacity.data, i));
  }

  const shColumns = table.columns
    .filter(column => column.name.startsWith('f_rest_'))
    .toSorted((a, b) => {
      const aIndex = Number.parseInt(a.name.slice('f_rest_'.length), 10);
      const bIndex = Number.parseInt(b.name.slice('f_rest_'.length), 10);
      return aIndex - bIndex;
    });

  const shDegree = inferShDegree(shColumns.length);
  let shData: Float32Array | undefined;
  if (shColumns.length > 0) {
    shData = new Float32Array(splatCount * shColumns.length);
    for (let i = 0; i < splatCount; i += 1) {
      for (let j = 0; j < shColumns.length; j += 1) {
        shData[i * shColumns.length + j] = valueAt(shColumns[j].data, i);
      }
    }
  }

  const boundingBox = computeBoundingBox(data, splatCount);
  const metadata = buildMetadata(
    inputFormat as GaussianSplatFormat,
    splatCount,
    boundingBox,
    file.size,
    shDegree > 0,
    shDegree,
  );
  metadata.compressionType = inputFormat === 'spz' || inputFormat === 'sog' || inputFormat === 'lcc' || inputFormat === 'ksplat'
    ? 'quantized'
    : 'none';

  const buffer: GaussianSplatBuffer = {
    data,
    splatCount,
    shData,
    shDegree,
  };

  return {
    metadata,
    frames: [{ index: 0, buffer }],
    sourceFile: file,
    sourceUrl: '',
  };
}

export function canLoadWithSplatTransform(file: File, format?: GaussianSplatFormat): boolean {
  return detectSplatTransformInputFormat(file, format) !== null;
}

export async function loadWithSplatTransform(
  file: File,
  format?: GaussianSplatFormat,
  options?: GaussianSplatLoadOptions,
): Promise<GaussianSplatAsset> {
  const inputFormat = detectSplatTransformInputFormat(file, format);
  if (!inputFormat) {
    throw new Error(`Unsupported splat-transform input format for ${file.name}`);
  }

  options?.onProgress?.({
    phase: 'reading',
    loadedBytes: 0,
    totalBytes: file.size,
    percent: 0,
    message: 'Reading splat file',
  });

  const fileSystem = new BlobReadFileSystem(options?.onProgress);
  fileSystem.set(file.name, file);

  let tables: DataTable[];
  const lowerName = file.name.toLowerCase();

  if (inputFormat === 'sog' && lowerName.endsWith('.sog')) {
    const source = await fileSystem.createSource(file.name);
    const zipFileSystem = new ZipReadFileSystem(source);
    try {
      tables = await readFile({
        filename: 'meta.json',
        inputFormat,
        options: DEFAULT_OPTIONS,
        params: [],
        fileSystem: zipFileSystem,
      });
    } finally {
      zipFileSystem.close();
      source.close();
    }
  } else {
    tables = await readFile({
      filename: file.name,
      inputFormat,
      options: DEFAULT_OPTIONS,
      params: [],
      fileSystem,
    });
  }

  options?.onProgress?.({
    phase: 'parsing',
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 0.76,
    message: 'Converting splat tables',
  });

  const table = tables[0];
  if (!table) {
    throw new Error(`No splat data tables found in ${file.name}`);
  }

  const alreadyMortonOrdered = inputFormat === 'sog' || lowerName.endsWith('.compressed.ply');
  if (!alreadyMortonOrdered) {
    options?.onProgress?.({
      phase: 'parsing',
      loadedBytes: file.size,
      totalBytes: file.size,
      percent: 0.84,
      message: 'Sorting splats',
    });
    sortTableByMortonOrder(table);
  }

  options?.onProgress?.({
    phase: 'parsing',
    loadedBytes: file.size,
    totalBytes: file.size,
    percent: 0.92,
    message: 'Building splat buffers',
  });

  return convertTableToAsset(table, file, inputFormat);
}
