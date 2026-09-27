import { FlockGpuCheckpoints } from '../../src/engine/flock/gpu/FlockGpuCheckpoints';
import { flockCheckpointStore } from '../../src/engine/flock/runtime/flockCheckpointStore';

/** Real GPU round trips for auxiliary state, as required by APIC's 9 floats. */
export async function checkGpuCheckpoints(device: GPUDevice) {
  const resources: GPUBuffer[] = [];
  const stores: FlockGpuCheckpoints[] = [];
  const clipId = `checkpoint-gpu-test-${crypto.randomUUID()}`;
  const count = 257;
  const particleBytes = count * 64, affineBytes = count * 36, ringBytes = 7 * 8 * 16;
  const buffer = (size: number) => {
    const result = device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    resources.push(result); return result;
  };
  const bytes = (length: number, salt: number) => Uint8Array.from({ length }, (_, i) => (i * 37 + salt) & 255);
  const equal = (actual: ArrayBuffer, expected: Uint8Array, label: string) => {
    const data = new Uint8Array(actual);
    if (data.length !== expected.length || data.some((v, i) => v !== expected[i])) throw new Error(`${label}: bytes differ`);
  };
  const read = async (source: GPUBuffer) => {
    const staging = device.createBuffer({ size: source.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(source, 0, staging, 0, source.size);
    device.queue.submit([encoder.finish()]);
    try { await staging.mapAsync(GPUMapMode.READ); return staging.getMappedRange().slice(0); }
    finally { staging.destroy(); }
  };
  let stats = { bytes: 0, steps: [] as number[] };
  const create = (auxiliarySize = affineBytes) => {
    const particles = [buffer(particleBytes), buffer(particleBytes)], affine = buffer(auxiliarySize), ring = buffer(ringBytes);
    const store = new FlockGpuCheckpoints(device, particleBytes, [affine], [ring], (size, steps) => { stats = { bytes: size, steps }; });
    stores.push(store); return { store, particles, affine, ring };
  };
  try {
    const source = create(), imported = create(), adopted = create();
    const particleData = bytes(particleBytes, 11), affineData = bytes(affineBytes, 23), ringData = bytes(ringBytes, 41);
    const packed = new Uint8Array(particleBytes + affineBytes); packed.set(particleData); packed.set(affineData, particleBytes);
    device.queue.writeBuffer(source.particles[0], 0, particleData);
    device.queue.writeBuffer(source.affine, 0, affineData); device.queue.writeBuffer(source.ring, 0, ringData);
    const capture = (encoder: GPUCommandEncoder, step: number) => source.store.capture(encoder, step, destination => {
      encoder.copyBufferToBuffer(source.particles[0], 0, destination, 0, particleBytes);
    });
    const encoder = device.createCommandEncoder(); capture(encoder, 4); device.queue.submit([encoder.finish()]); source.store.releaseRetired();
    const persisted = await source.store.read(4);
    if (!persisted) throw new Error('Missing captured state');
    equal(persisted.state, packed, 'packed particles + affine'); equal(persisted.rings[0], ringData, 'captured trail');
    const oldKey = `${clipId}|old`, newKey = `${clipId}|new`;
    for (const cacheKey of [oldKey, newKey]) {
      const stored = await flockCheckpointStore.put({ cacheKey, clipId, step: 4, ...persisted });
      if (!stored.ok) throw new Error(stored.message);
    }
    if (await flockCheckpointStore.pruneClip(clipId, newKey) !== 1) throw new Error('Key-only cache pruning failed');
    if ((await flockCheckpointStore.listSteps(oldKey)).length || (await flockCheckpointStore.listSteps(newKey)).join(',') !== '4') throw new Error('Wrong cache retained');
    const disk = await flockCheckpointStore.get(newKey, 4);
    if (!disk) throw new Error('Persisted checkpoint missing');
    equal(disk.state, packed, 'IndexedDB state'); equal(disk.rings[0], ringData, 'IndexedDB trail');
    if (stats.bytes !== packed.byteLength + ringBytes) throw new Error('Auxiliary bytes missing from budget');
    if (imported.store.import(4, persisted.state.slice(0, particleBytes), persisted.rings)) throw new Error('Truncated auxiliary accepted');
    if (imported.store.import(4, persisted.state, [new ArrayBuffer(4)])) throw new Error('Wrong trail size accepted');
    if (!imported.store.import(4, persisted.state, persisted.rings)) throw new Error('Import failed');
    if (adopted.store.adopt(source.store, [4]) !== 1 || adopted.store.adopt(source.store, [4]) !== 0) throw new Error('Adoption failed/duplicated');
    if (create(affineBytes + 4).store.adopt(source.store, [4]) !== 0) throw new Error('Incompatible auxiliary layout adopted');
    for (const target of [source, imported, adopted]) {
      // Overwrite every live section before restoring, including interpolation.
      const clear = device.createCommandEncoder();
      for (const item of [...target.particles, target.affine, target.ring]) clear.clearBuffer(item);
      if (!target.store.restore(clear, 4, target.particles)) throw new Error('Restore failed');
      device.queue.submit([clear.finish()]);
      for (const particles of target.particles) equal(await read(particles), particleData, 'restored interpolation state');
      equal(await read(target.affine), affineData, 'restored affine'); equal(await read(target.ring), ringData, 'restored trail');
    }
    // Several captures in one submission: thinning must not destroy buffers
    // referenced by an encoder that has not yet been submitted.
    source.store.maxBytes = packed.byteLength + ringBytes;
    const batch = device.createCommandEncoder();
    for (const step of [8, 12, 16]) capture(batch, step);
    device.queue.submit([batch.finish()]); source.store.releaseRetired();
    if (source.store.steps().join(',') !== '16' || source.store.atOrBefore(15) !== 0) throw new Error('Budget thinning failed');
    const pending = source.store.read(16);
    source.store.invalidateFrom(0);
    const result = await pending;
    if (!result || source.store.steps().length !== 0) throw new Error('Read/invalidation race');
    equal(result.state, packed, 'read survives invalidation');
    const oneSnapshot = packed.byteLength + ringBytes;
    imported.store.maxBytes = oneSnapshot;
    for (const step of [8, 12, 16]) {
      if (!imported.store.import(step, persisted.state, persisted.rings)) throw new Error('Bounded import failed');
      if (imported.store.steps().length !== 1) throw new Error('Import bypassed checkpoint budget');
    }
    adopted.store.maxBytes = oneSnapshot;
    if (adopted.store.adopt(imported.store, [16]) !== 1 || adopted.store.steps().join(',') !== '16') throw new Error('Adoption bypassed checkpoint budget');
    adopted.store.maxBytes = oneSnapshot - 1;
    if (adopted.store.steps().length || adopted.store.import(20, persisted.state, persisted.rings)
      || adopted.store.adopt(imported.store, [16])) throw new Error('Oversized snapshot accepted');
    return { auxiliaryCheckpoint: 'byte-exact', count, bytesPerParticle: 100, restore: true, import: true, adopt: true, budget: true, pendingReadEviction: true };
  } finally { stores.forEach(store => store.clear()); resources.forEach(resource => resource.destroy()); await flockCheckpointStore.pruneClip(clipId); }
}
