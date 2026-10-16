#!/usr/bin/env node
// Build a MasterSelects LOD splat package (.lod.zip) from one gaussian splat PLY.
//
// The package follows the PlayCanvas "Streamed SOG" lod-meta.json tree (leaf nodes reference a
// {file, offset, count} range per LOD level, level 0 = most detailed), but stores the chunks as raw
// MasterSelects records so the editor can read any range straight from the file without decoding:
//   lod-meta.json
//   lod<N>.bin     14 float32 per splat [x,y,z, sx,sy,sz, qw,qx,qy,qz, r,g,b, opacity]
//   lod<N>.sh.bin  packed SH (src/engine/gaussian/loaders/shPacking.ts layout), when present
// The zip is written uncompressed ("stored") so entries can be sliced directly.
//
// Usage: node scripts/build-splat-lod.mjs <input.ply> <output.lod.zip> [--levels 5] [--leaf 65536]
// Coarser levels are made with `splat-transform --decimate` (splat-transform 3.x or newer; the repo's
// browser dependency may be older). Set SPLAT_TRANSFORM to its CLI, e.g. "npx -y @playcanvas/splat-transform@3".
// Temporary PLYs are written next to the output and removed afterwards.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const [input, output] = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input || !output) {
  console.error('Usage: node scripts/build-splat-lod.mjs <input.ply> <output.lod.zip> [--levels 5] [--leaf 65536]');
  process.exit(1);
}
const LEVELS = Math.max(1, Math.min(8, option('--levels', 5)));
const LEAF = Math.max(1024, option('--leaf', 65536));
const SH_C0 = 0.28209479177387814;

// ── PLY reading ──────────────────────────────────────────────────────────────
const TYPE_SIZE = { float: 4, float32: 4, uchar: 1, uint8: 1, double: 8, int: 4, uint: 4, short: 2, ushort: 2 };
function readHeader(fd) {
  const head = Buffer.alloc(65536);
  fs.readSync(fd, head, 0, head.length, 0);
  const text = head.toString('latin1');
  const end = text.indexOf('end_header\n');
  if (end < 0) throw new Error('Not a PLY file');
  const lines = text.slice(0, end).split('\n');
  if (!lines.some(l => l.startsWith('format binary_little_endian'))) throw new Error('Only binary_little_endian PLY is supported');
  const count = Number(lines.find(l => l.startsWith('element vertex')).split(/\s+/)[2]);
  const props = []; let offset = 0;
  for (const line of lines) {
    const m = line.match(/^property (\w+) (\w+)$/);
    if (!m) continue;
    const size = TYPE_SIZE[m[1]];
    if (!size) throw new Error(`Unsupported PLY property type ${m[1]}`);
    props.push({ name: m[2], type: m[1], offset }); offset += size;
  }
  return { count, props, stride: offset, dataStart: end + 'end_header\n'.length };
}
const readValue = (buf, o, type) => type === 'float' || type === 'float32' ? buf.readFloatLE(o)
  : type === 'double' ? buf.readDoubleLE(o) : type === 'uchar' || type === 'uint8' ? buf.readUInt8(o)
    : type === 'short' ? buf.readInt16LE(o) : type === 'ushort' ? buf.readUInt16LE(o) : type === 'int' ? buf.readInt32LE(o) : buf.readUInt32LE(o);

/** Canonical records and packed SH, matching SplatTransformLoader + shPacking.ts. */
function readLevel(file) {
  const fd = fs.openSync(file, 'r');
  const { count, props, stride, dataStart } = readHeader(fd);
  const prop = name => props.find(p => p.name === name);
  const need = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'].map(n => {
    const p = prop(n); if (!p) throw new Error(`${file}: missing ${n}`); return p;
  });
  const rest = props.filter(p => p.name.startsWith('f_rest_')).sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7)));
  const coeffsPerChannel = Math.floor(rest.length / 3);
  const words = coeffsPerChannel > 0 ? 1 + Math.ceil(coeffsPerChannel * 3 / 4) : 0;
  const data = new Float32Array(count * 14);
  const sh = words ? new Uint32Array(count * words) : null;
  const shScale = sh ? new Float32Array(sh.buffer) : null;
  const values = new Float32Array(coeffsPerChannel * 3);
  const BATCH = 16384; const buf = Buffer.alloc(BATCH * stride);
  for (let start = 0; start < count; start += BATCH) {
    const n = Math.min(BATCH, count - start);
    fs.readSync(fd, buf, 0, n * stride, dataStart + start * stride);
    for (let k = 0; k < n; k += 1) {
      const o = k * stride; const i = start + k; const b = i * 14;
      const v = need.map(p => readValue(buf, o + p.offset, p.type));
      data[b] = v[0]; data[b + 1] = v[1]; data[b + 2] = v[2];
      data[b + 3] = Math.exp(v[3]); data[b + 4] = Math.exp(v[4]); data[b + 5] = Math.exp(v[5]);
      const len = Math.hypot(v[6], v[7], v[8], v[9]);
      if (len < 1e-10) { data[b + 6] = 1; } else { data[b + 6] = v[6] / len; data[b + 7] = v[7] / len; data[b + 8] = v[8] / len; data[b + 9] = v[9] / len; }
      data[b + 10] = 0.5 + SH_C0 * v[10]; data[b + 11] = 0.5 + SH_C0 * v[11]; data[b + 12] = 0.5 + SH_C0 * v[12];
      data[b + 13] = 1 / (1 + Math.exp(-v[13]));
      if (!sh) continue;
      let max = 0;
      for (let j = 0; j < values.length; j += 1) {
        const value = readValue(buf, o + rest[j].offset, rest[j].type);
        values[j] = Number.isFinite(value) ? value : 0; max = Math.max(max, Math.abs(values[j]));
      }
      const base = i * words; shScale[base] = max;
      if (max === 0) continue;
      for (let j = 0; j < values.length; j += 1) sh[base + 1 + (j >> 2)] |= Math.round((values[j] / max * 0.5 + 0.5) * 255) << ((j & 3) * 8);
    }
  }
  fs.closeSync(fd);
  return { count, data, sh, coeffsPerChannel, words };
}

// ── Spatial partition (k-d tree on the most detailed level) ──────────────────
function buildTree(level0) {
  const { data, count } = level0;
  const leaves = []; const ids = new Uint32Array(count); for (let i = 0; i < count; i += 1) ids[i] = i;
  const coord = (id, axis) => data[id * 14 + axis];
  function select(arr, lo, hi, k, axis) { // quickselect on arr[lo..hi]
    while (hi > lo) {
      const pivot = coord(arr[(lo + hi) >> 1], axis); let i = lo; let j = hi;
      while (i <= j) {
        while (coord(arr[i], axis) < pivot) i += 1;
        while (coord(arr[j], axis) > pivot) j -= 1;
        if (i <= j) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; i += 1; j -= 1; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else return;
    }
  }
  function build(lo, hi) { // half-open [lo, hi)
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    for (let i = lo; i < hi; i += 1) for (let a = 0; a < 3; a += 1) { const c = coord(ids[i], a); if (c < min[a]) min[a] = c; if (c > max[a]) max[a] = c; }
    if (hi - lo <= LEAF) { leaves.push({ min, max }); return { leaf: leaves.length - 1 }; }
    const axis = [0, 1, 2].reduce((best, a) => (max[a] - min[a] > max[best] - min[best] ? a : best), 0);
    const mid = (lo + hi) >> 1; select(ids, lo, hi - 1, mid, axis);
    return { axis, split: coord(ids[mid], axis), left: build(lo, mid), right: build(mid, hi) };
  }
  return { root: build(0, count), leaves };
}
const leafOf = (node, x, y, z) => { let n = node; while (n.leaf === undefined) n = [x, y, z][n.axis] < n.split ? n.left : n.right; return n.leaf; };

// ── Zip (stored) ─────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes, crc = 0xffffffff) { for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8); return crc; }
function writeZip(file, entries) {
  const fd = fs.openSync(file, 'w'); let offset = 0; const central = [];
  const write = b => { fs.writeSync(fd, b); offset += b.length; };
  for (const { name, bytes } of entries) {
    const nameBytes = Buffer.from(name); const crc = (crc32(bytes) ^ 0xffffffff) >>> 0;
    if (offset + bytes.length > 0xffffffff) throw new Error('Package exceeds 4 GB; use fewer levels or a smaller input.');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    central.push({ nameBytes, crc, size: bytes.length, offset }); write(local); write(nameBytes); write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  }
  const dirStart = offset;
  for (const e of central) {
    const h = Buffer.alloc(46); h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(e.size, 20); h.writeUInt32LE(e.size, 24); h.writeUInt16LE(e.nameBytes.length, 28); h.writeUInt32LE(e.offset, 42);
    write(h); write(e.nameBytes);
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - dirStart, 12); end.writeUInt32LE(dirStart, 16); write(end); fs.closeSync(fd);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(path.dirname(path.resolve(output)), '.lod-build-'));
try {
  const files = [path.resolve(input)];
  for (let level = 1; level < LEVELS; level += 1) {
    const out = path.join(tmpDir, `level${level}.ply`);
    console.log(`decimating level ${level} to ${100 / 2 ** level}%`);
    const [command, ...prefix] = (process.env.SPLAT_TRANSFORM || 'npx -y @playcanvas/splat-transform@3').split(' ');
    execFileSync(command, [...prefix, '-w', files[0], '-d', `${100 / 2 ** level}%`, out], { stdio: 'ignore' });
    files.push(out);
  }
  console.log('reading level 0'); const levels = [readLevel(files[0])];
  const tree = buildTree(levels[0]);
  console.log(`partitioned ${levels[0].count} splats into ${tree.leaves.length} leaves`);
  const entries = []; const leafLods = tree.leaves.map(() => ({}));
  for (let level = 0; level < LEVELS; level += 1) {
    const lv = level === 0 ? levels[0] : readLevel(files[level]);
    if (lv.coeffsPerChannel !== levels[0].coeffsPerChannel) throw new Error('All levels must keep the same SH bands.');
    const leafIds = new Uint32Array(lv.count); const counts = new Uint32Array(tree.leaves.length);
    for (let i = 0; i < lv.count; i += 1) {
      const b = i * 14; const leaf = leafOf(tree.root, lv.data[b], lv.data[b + 1], lv.data[b + 2]);
      leafIds[i] = leaf; counts[leaf] += 1;
      const box = tree.leaves[leaf];
      for (let a = 0; a < 3; a += 1) { box.min[a] = Math.min(box.min[a], lv.data[b + a]); box.max[a] = Math.max(box.max[a], lv.data[b + a]); }
    }
    const starts = new Uint32Array(tree.leaves.length); for (let l = 1; l < starts.length; l += 1) starts[l] = starts[l - 1] + counts[l - 1];
    const cursor = starts.slice(); const data = new Float32Array(lv.count * 14); const sh = lv.sh ? new Uint32Array(lv.count * lv.words) : null;
    for (let i = 0; i < lv.count; i += 1) {
      const to = cursor[leafIds[i]]++;
      data.set(lv.data.subarray(i * 14, i * 14 + 14), to * 14);
      if (sh) sh.set(lv.sh.subarray(i * lv.words, (i + 1) * lv.words), to * lv.words);
    }
    tree.leaves.forEach((_, leaf) => { if (counts[leaf]) leafLods[leaf][level] = { file: level, offset: starts[leaf], count: counts[leaf] }; });
    entries.push({ name: `lod${level}.bin`, bytes: new Uint8Array(data.buffer) });
    if (sh) entries.push({ name: `lod${level}.sh.bin`, bytes: new Uint8Array(sh.buffer) });
    console.log(`level ${level}: ${lv.count} splats`);
  }
  const toJson = node => node.leaf !== undefined
    ? { bound: { min: tree.leaves[node.leaf].min, max: tree.leaves[node.leaf].max }, lods: leafLods[node.leaf] }
    : (() => { const l = toJson(node.left); const r = toJson(node.right);
      return { bound: { min: l.bound.min.map((v, a) => Math.min(v, r.bound.min[a])), max: l.bound.max.map((v, a) => Math.max(v, r.bound.max[a])) }, children: [l, r] }; })();
  const meta = { version: 1, asset: { generator: 'MasterSelects build-splat-lod', format: 'masterselects-raw-v1', leafGaussians: LEAF },
    lodLevels: LEVELS, shCoeffsPerChannel: levels[0].coeffsPerChannel,
    files: Array.from({ length: LEVELS }, (_, l) => ({ data: `lod${l}.bin`, ...(levels[0].sh ? { sh: `lod${l}.sh.bin` } : {}) })),
    tree: toJson(tree.root) };
  writeZip(output, [{ name: 'lod-meta.json', bytes: new Uint8Array(Buffer.from(JSON.stringify(meta))) }, ...entries]);
  console.log(`wrote ${output} (${(fs.statSync(output).size / 1e9).toFixed(2)} GB)`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
