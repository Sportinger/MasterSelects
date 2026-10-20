/**
 * MasterSelects LOD splat packages (`*.lod.zip`, built by scripts/build-splat-lod.mjs).
 *
 * The zip is stored (uncompressed), so chunk ranges are read straight from the File with Blob.slice.
 * `lod-meta.json` follows the PlayCanvas Streamed SOG tree: leaves carry `lods: { level: {file,
 * offset, count} }`, level 0 is the most detailed. Chunks are raw canonical records (14 float32 per
 * splat, in the source PLY's basis; converted to the editor basis on read like every loader) plus
 * optional packed SH (see loaders/shPacking.ts).
 */
import type { GaussianSplatAsset, GaussianSplatMetadata } from '../loaders/types';
import { applyCanonicalBasisCorrection } from '../loaders/normalize';

/** Box in the editor's Y-up basis: the loaders negate Y and Z of every imported scene. */
function correctedBounds(min: number[], max: number[]) {
  return { min: [min[0], -max[1], -max[2]] as [number, number, number], max: [max[0], -min[1], -min[2]] as [number, number, number] };
}

export interface LodLeaf {
  min: [number, number, number];
  max: [number, number, number];
  /** Per level: splat range inside that level's files, or undefined when the level is empty here. */
  lods: ({ file: number; offset: number; count: number } | undefined)[];
}

export interface LodPackage {
  file: Blob;
  levels: number;
  shCoeffsPerChannel: number;
  leaves: LodLeaf[];
  /** Byte offset and length of each level's data / SH entry inside the zip. */
  entries: { data: { offset: number; size: number }; sh?: { offset: number; size: number } }[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Splats per level over all leaves. */
  counts: number[];
}

interface ZipEntry { offset: number; size: number; method: number }

const LOD_FORMAT = 'masterselects-raw-v1';

async function readBytes(file: Blob, start: number, length: number): Promise<DataView> {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}

/** Central directory of a zip, resolving each entry's data offset from its local header. */
export async function readZipDirectory(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailLength = Math.min(file.size, 65557);
  const tail = await readBytes(file, file.size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tailLength - 22; i >= 0; i -= 1) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file (no end of central directory).');
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirOffset = tail.getUint32(eocd + 16, true);
  const dir = await readBytes(file, dirOffset, dirSize);
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (dir.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt zip central directory.');
    const method = dir.getUint16(p + 10, true);
    const size = dir.getUint32(p + 20, true);
    const nameLength = dir.getUint16(p + 28, true); const extraLength = dir.getUint16(p + 30, true); const commentLength = dir.getUint16(p + 32, true);
    const localOffset = dir.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLength));
    const local = await readBytes(file, localOffset, 30);
    entries.set(name, { offset: localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true), size, method });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

interface MetaNode { bound: { min: number[]; max: number[] }; children?: MetaNode[]; lods?: Record<string, { file: number; offset: number; count: number }> }

/** Null when `file` is not a MasterSelects LOD package (other zips keep the regular loader). */
export async function openLodPackage(file: Blob): Promise<LodPackage | null> {
  let directory: Map<string, ZipEntry>;
  try { directory = await readZipDirectory(file); } catch { return null; }
  const metaEntry = directory.get('lod-meta.json');
  if (!metaEntry || metaEntry.method !== 0) return null;
  const meta = JSON.parse(await file.slice(metaEntry.offset, metaEntry.offset + metaEntry.size).text());
  if (meta?.asset?.format !== LOD_FORMAT) return null;
  const levels = Number(meta.lodLevels) || 0;
  const entries = (meta.files as { data: string; sh?: string }[]).map(names => {
    const data = directory.get(names.data); const sh = names.sh ? directory.get(names.sh) : undefined;
    if (!data || data.method !== 0 || (sh && sh.method !== 0)) throw new Error(`LOD package entry ${names.data} is missing or compressed.`);
    return { data: { offset: data.offset, size: data.size }, ...(sh ? { sh: { offset: sh.offset, size: sh.size } } : {}) };
  });
  const leaves: LodLeaf[] = [];
  const visit = (node: MetaNode) => {
    if (node.children) { node.children.forEach(visit); return; }
    const lods = Array.from({ length: levels }, (_, level) => node.lods?.[level]);
    leaves.push({ ...correctedBounds(node.bound.min, node.bound.max), lods });
  };
  visit(meta.tree as MetaNode);
  const counts = Array.from({ length: levels }, (_, level) => leaves.reduce((sum, leaf) => sum + (leaf.lods[level]?.count ?? 0), 0));
  return { file, levels, shCoeffsPerChannel: Number(meta.shCoeffsPerChannel) || 0, leaves, entries, counts,
    bounds: correctedBounds(meta.tree.bound.min, meta.tree.bound.max) };
}

export function lodShWords(pkg: LodPackage): number {
  return pkg.shCoeffsPerChannel > 0 ? 1 + Math.ceil((pkg.shCoeffsPerChannel * 3) / 4) : 0;
}

/** Read one leaf's splats of one level: canonical records and (if present) packed SH. */
export async function readLodChunk(pkg: LodPackage, level: number, range: { file: number; offset: number; count: number }) {
  const entry = pkg.entries[range.file];
  const dataStart = entry.data.offset + range.offset * 56;
  const data = new Float32Array(await pkg.file.slice(dataStart, dataStart + range.count * 56).arrayBuffer());
  applyCanonicalBasisCorrection(data, range.count); // same basis as every other imported splat scene
  const words = lodShWords(pkg);
  let sh: Uint32Array | undefined;
  if (entry.sh && words > 0) {
    const shStart = entry.sh.offset + range.offset * words * 4;
    sh = new Uint32Array(await pkg.file.slice(shStart, shStart + range.count * words * 4).arrayBuffer());
  }
  return { level, count: range.count, data, sh };
}

/** Header metadata of a LOD package: the finest level's splat count and the tree bounds. */
export function lodPackageMetadata(pkg: LodPackage): GaussianSplatMetadata {
  const shDegree = pkg.shCoeffsPerChannel >= 15 ? 3 : pkg.shCoeffsPerChannel >= 8 ? 2 : pkg.shCoeffsPerChannel >= 3 ? 1 : 0;
  return { format: 'gsplat-zip', splatCount: pkg.counts[0] ?? 0, isTemporal: false, frameCount: 1, fps: 0, totalDuration: 0,
    boundingBox: pkg.bounds, byteSize: pkg.file.size, perSplatByteStride: 56, hasSphericalHarmonics: shDegree > 0, shDegree, compressionType: 'none' };
}

/**
 * Whole-asset view of a LOD package for consumers that need one buffer (thumbnails, bounds, meshes):
 * its coarsest level. The renderer streams the finer levels itself (SplatLodScene).
 */
export async function loadLodPreviewAsset(pkg: LodPackage, file: File): Promise<GaussianSplatAsset> {
  const level = pkg.levels - 1;
  const chunk = await readLodChunk(pkg, level, { file: level, offset: 0, count: pkg.counts[level] });
  const metadata = lodPackageMetadata(pkg);
  return { metadata, sourceFile: file, sourceUrl: '', frames: [{ index: 0, buffer: { data: chunk.data, splatCount: chunk.count,
    shDegree: metadata.shDegree, ...(chunk.sh ? { shData: chunk.sh, shCoeffsPerChannel: pkg.shCoeffsPerChannel } : {}) } }] };
}
