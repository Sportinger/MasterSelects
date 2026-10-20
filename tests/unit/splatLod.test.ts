// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadLodPreviewAsset, openLodPackage, readLodChunk } from '../../src/engine/gaussian/lod/lodPackage';
import { displaceLodPoint, localCamera, lodLeafDistance, lodLevelForDistance, selectLodLevels } from '../../src/engine/gaussian/lod/lodSelection';
import type { SplatGraphOperation } from '../../src/types/splatGraph';

/** Minimal stored zip, laid out like scripts/build-splat-lod.mjs writes it (CRCs are not checked). */
function storedZip(entries: { name: string; bytes: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const { name, bytes } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true); local.setUint16(26, nameBytes.length, true);
    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true); header.setUint32(20, bytes.length, true); header.setUint32(24, bytes.length, true);
    header.setUint16(28, nameBytes.length, true); header.setUint32(42, offset, true);
    central.push(new Uint8Array(header.buffer), nameBytes);
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes); offset += 30 + nameBytes.length + bytes.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)].map(b => b.slice().buffer as ArrayBuffer));
}

function lodTestPackage() {
  // Two leaves, two levels; each splat's x encodes (level, index) so chunk reads can be checked.
  const level = (count: number, base: number) => { const data = new Float32Array(count * 14); for (let i = 0; i < count; i += 1) data[i * 14] = base + i; return data; };
  const sh = (count: number, base: number) => Uint32Array.from({ length: count * 4 }, (_, i) => base + i); // 3 coeffs/channel -> 4 words
  const meta = { asset: { format: 'masterselects-raw-v1' }, lodLevels: 2, shCoeffsPerChannel: 3,
    files: [{ data: 'lod0.bin', sh: 'lod0.sh.bin' }, { data: 'lod1.bin', sh: 'lod1.sh.bin' }],
    tree: { bound: { min: [0, 0, 0], max: [2, 1, 1] }, children: [
      { bound: { min: [0, 0, 0], max: [1, 1, 1] }, lods: { 0: { file: 0, offset: 0, count: 3 }, 1: { file: 1, offset: 0, count: 1 } } },
      { bound: { min: [1, 0, 0], max: [2, 1, 1] }, lods: { 0: { file: 0, offset: 3, count: 2 }, 1: { file: 1, offset: 1, count: 1 } } },
    ] } };
  const bytes = (array: Float32Array | Uint32Array) => new Uint8Array(array.buffer);
  return storedZip([
    { name: 'lod-meta.json', bytes: new TextEncoder().encode(JSON.stringify(meta)) },
    { name: 'lod0.bin', bytes: bytes(level(5, 100)) }, { name: 'lod0.sh.bin', bytes: bytes(sh(5, 1000)) },
    { name: 'lod1.bin', bytes: bytes(level(2, 200)) }, { name: 'lod1.sh.bin', bytes: bytes(sh(2, 2000)) },
  ]);
}

describe('splat LOD package', () => {
  it('reads the tree, per-level counts and leaf chunks with their SH', async () => {
    const pkg = await openLodPackage(lodTestPackage());
    expect(pkg).not.toBeNull();
    expect(pkg!.levels).toBe(2);
    expect(pkg!.counts).toEqual([5, 2]);
    expect(pkg!.leaves).toHaveLength(2);
    expect(pkg!.leaves[1].min).toEqual([1, -1, -1]);
    const chunk = await readLodChunk(pkg!, 0, pkg!.leaves[1].lods[0]!);
    expect(chunk.count).toBe(2);
    expect([chunk.data[0], chunk.data[14]]).toEqual([103, 104]);
    expect(Array.from(chunk.sh!.slice(0, 2))).toEqual([1012, 1013]);
  });

  it('exposes the coarsest level as the whole-asset preview', async () => {
    const blob = lodTestPackage();
    const asset = await loadLodPreviewAsset((await openLodPackage(blob))!, new File([blob], 'scene.lod.zip'));
    expect(asset.metadata.splatCount).toBe(5);
    // Converted to the editor's Y-up basis like every loader (Y and Z negated).
    expect(asset.metadata.boundingBox).toEqual({ min: [0, -1, -1], max: [2, -0, -0] });
    expect(asset.frames[0].buffer.splatCount).toBe(2);
    expect(asset.frames[0].buffer.data[14]).toBe(201);
    expect(asset.frames[0].buffer.shCoeffsPerChannel).toBe(3);
  });

  it('rejects zips that are not LOD packages', async () => {
    expect(await openLodPackage(storedZip([{ name: 'scene.ply', bytes: new Uint8Array(4) }]))).toBeNull();
    expect(await openLodPackage(new Blob([new Uint8Array(64)]))).toBeNull();
  });
});

describe('splat LOD selection', () => {
  it('maps distance bands of factor 3 to levels', () => {
    expect([0.5, 1.1, 2.9, 3.1, 8.9, 9.5, 1000].map(d => lodLevelForDistance(d, 1, 4))).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('fills the budget with the finest levels nearest the camera', () => {
    const leaves = [1, 10, 100].map(distance => ({ distance, counts: [1000, 500, 250, 125] }));
    const all = selectLodLevels(leaves, 4, 3000);
    expect(Array.from(all.levels)).toEqual([0, 0, 0]);
    const tight = selectLodLevels(leaves, 4, 1600);
    expect(tight.splats).toBeLessThanOrEqual(1600);
    expect(tight.levels[0]).toBe(0);
    expect(tight.levels[2]).toBeGreaterThan(tight.levels[1]);
    const over = selectLodLevels(leaves, 4, 100);
    expect(over.overBudget).toBe(true);
    expect(Array.from(over.levels)).toEqual([3, 3, 3]);
  });

  it('follows Conveyor wraps and closed Ring Bends like the graph shader', () => {
    const conveyor: SplatGraphOperation = { kind: 'conveyor', values: [2, 0, -55, 110, 30] };
    expect(displaceLodPoint([0, 0, 50], [conveyor], 0)[2]).toBeCloseTo(-30);
    const radius = 110 / (2 * Math.PI);
    const ring: SplatGraphOperation = { kind: 'ring-bend', values: [2, 0, radius, 0, 0, 1] };
    const quarter = displaceLodPoint([0, 0, radius * Math.PI / 2], [ring], 0);
    expect(quarter[2]).toBeCloseTo(radius);
    expect(quarter[1]).toBeCloseTo(radius);
    expect(displaceLodPoint([0, 0, 5], [{ ...ring, values: [2, 0, radius, 0, 0, 0] }], 0)).toEqual([0, 0, 5]);
  });

  it('penalises leaves behind the camera', () => {
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // at origin, looking down -Z
    const camera = localCamera(view, view);
    expect(lodLeafDistance([0, 0, -10], 1, camera)).toBeCloseTo(9);
    expect(lodLeafDistance([0, 0, 10], 1, camera)).toBeCloseTo(45);
  });
});
