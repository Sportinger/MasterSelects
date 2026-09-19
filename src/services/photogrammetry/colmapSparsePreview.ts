interface ColmapPoint {
  x: number;
  y: number;
  z: number;
  red: number;
  green: number;
  blue: number;
}

export interface ColmapSparsePreviewResult {
  file: File;
  pointCount: number;
}

const PLY_VERTEX_STRIDE = 15;

async function getDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function getFile(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<File | null> {
  try {
    return await (await parent.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

function readFileBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

function readUint64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x1_0000_0000;
}

function parseBinaryPoints(buffer: ArrayBuffer): ColmapPoint[] {
  const view = new DataView(buffer);
  if (view.byteLength < 8) throw new Error('COLMAP points3D.bin is truncated.');
  const count = readUint64(view, 0);
  if (!Number.isSafeInteger(count) || count > 10_000_000) {
    throw new Error('COLMAP point count is invalid or too large for the browser.');
  }

  const points: ColmapPoint[] = [];
  let offset = 8;
  for (let index = 0; index < count; index += 1) {
    if (offset + 51 > view.byteLength) throw new Error('COLMAP points3D.bin ended unexpectedly.');
    offset += 8; // point3D id
    const x = view.getFloat64(offset, true);
    const y = view.getFloat64(offset + 8, true);
    const z = view.getFloat64(offset + 16, true);
    offset += 24;
    const red = view.getUint8(offset);
    const green = view.getUint8(offset + 1);
    const blue = view.getUint8(offset + 2);
    offset += 3;
    const error = view.getFloat64(offset, true);
    offset += 8;
    const trackLength = readUint64(view, offset);
    offset += 8;
    const trackBytes = trackLength * 8;
    if (!Number.isSafeInteger(trackBytes) || offset + trackBytes > view.byteLength) {
      throw new Error('COLMAP points3D.bin contains an invalid observation track.');
    }
    offset += trackBytes;
    if ([x, y, z, error].every(Number.isFinite)) points.push({ x, y, z, red, green, blue });
  }
  return points;
}

async function parseTextPoints(file: File): Promise<ColmapPoint[]> {
  const text = typeof file.text === 'function'
    ? await file.text()
    : new TextDecoder().decode(await readFileBytes(file));
  return text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const fields = trimmed.split(/\s+/);
    if (fields.length < 8) return [];
    const [x, y, z] = fields.slice(1, 4).map(Number);
    const [red, green, blue] = fields.slice(4, 7).map(Number);
    return [x, y, z, red, green, blue].every(Number.isFinite)
      ? [{ x, y, z, red, green, blue }]
      : [];
  });
}

function createPointCloudPly(points: ColmapPoint[], name: string): File {
  if (points.length === 0) throw new Error('The COLMAP model contains no usable sparse points.');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    min[0] = Math.min(min[0], point.x); max[0] = Math.max(max[0], point.x);
    min[1] = Math.min(min[1], point.y); max[1] = Math.max(max[1], point.y);
    min[2] = Math.min(min[2], point.z); max[2] = Math.max(max[2], point.z);
  }
  const center = min.map((value, index) => (value + max[index]) * 0.5);
  const largestExtent = Math.max(1e-6, ...max.map((value, index) => value - min[index]));
  const sceneScale = 2 / largestExtent;
  const header = new TextEncoder().encode([
    'ply',
    'format binary_little_endian 1.0',
    'comment MasterSelects COLMAP sparse preview splat',
    `element vertex ${points.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '',
  ].join('\n'));
  const buffer = new ArrayBuffer(header.byteLength + points.length * PLY_VERTEX_STRIDE);
  const bytes = new Uint8Array(buffer);
  bytes.set(header);
  const view = new DataView(buffer);
  points.forEach((point, index) => {
    const offset = header.byteLength + index * PLY_VERTEX_STRIDE;
    view.setFloat32(offset, (point.x - center[0]) * sceneScale, true);
    view.setFloat32(offset + 4, (point.y - center[1]) * sceneScale, true);
    // The PLY loader and the default PLY orientation preset each flip Z.
    // Keep the normalized source in front of the default camera after both.
    view.setFloat32(offset + 8, (point.z - center[2]) * sceneScale - 2, true);
    view.setUint8(offset + 12, Math.max(0, Math.min(255, Math.round(point.red))));
    view.setUint8(offset + 13, Math.max(0, Math.min(255, Math.round(point.green))));
    view.setUint8(offset + 14, Math.max(0, Math.min(255, Math.round(point.blue))));
  });
  const safeName = name.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'scan';
  return new File([buffer], `${safeName}-sparse-preview.ply`, { type: 'application/octet-stream' });
}

export async function createColmapSparsePreviewSplat(
  handle: FileSystemDirectoryHandle,
  name: string,
): Promise<ColmapSparsePreviewResult> {
  const sparse = await getDirectory(handle, 'sparse');
  if (!sparse) throw new Error('The COLMAP dataset has no sparse/ model.');
  const model = await getDirectory(sparse, '0') ?? sparse;
  const binary = await getFile(model, 'points3D.bin');
  const text = binary ? null : await getFile(model, 'points3D.txt');
  const points = binary
    ? parseBinaryPoints(await readFileBytes(binary))
    : text ? await parseTextPoints(text) : [];
  return { file: createPointCloudPly(points, name), pointCount: points.length };
}
