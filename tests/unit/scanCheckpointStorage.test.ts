import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { BrushCheckpointWriter, BRUSH_CHECKPOINT_MANIFEST, readBrushCheckpoint, readCheckpointDataset } from '../../src/services/photogrammetry/brushCheckpointStorage';
import { persistLatestCameraSolve, loadLatestCameraSolve } from '../../src/services/photogrammetry/cameraSolveProjectStorage';
import type { ScanSourceStorage } from '../../src/services/photogrammetry/scanSourceProjectStorage';
import { BrushTrainingManager } from '../../src/services/photogrammetry/brushTrainingManager';
import { brushPreviewRuntime } from '../../src/services/photogrammetry/brushPreviewRuntime';
import type { CameraSolveDataset } from '../../src/services/photogrammetry/cameraSolvingContract';

function storage() {
  const files = new Map<string, File>();
  const host: ScanSourceStorage = {
    readFile: async (folder, path) => files.get(`${folder}/${path}`) ?? null,
    writeFile: vi.fn(async (folder, path, data) => { files.set(`${folder}/${path}`, new File([data], path)); return true; }),
    deleteFile: async (folder, path) => files.delete(`${folder}/${path}`),
  };
  return { files, host };
}
function dataset(): CameraSolveDataset {
  const files = ['images/one.jpg', 'sparse/0/cameras.txt', 'sparse/0/images.txt', 'sparse/0/points3D.txt'].map(path => {
    const file = new File([path], path.split('/').at(-1)!);
    Object.defineProperty(file, 'webkitRelativePath', { value: `scene/${path}` }); return file;
  });
  return { id: 'solve-1', createdAt: 100, files, source: null, model: { datasetName: 'scene',
    registeredSourceIndices: [0], camerasText: 'cameras', imagesText: 'images', pointsText: 'points' } };
}
const base = { version: 1 as const, jobId: 'job-1', datasetName: 'scene', datasetPath: 'scan-training/job-1/dataset.zip',
  preset: 'quality' as const, totalIterations: 6000, sourceVersion: 50, cameraPath: null };
const step = { iteration: 1050, splatCount: 17000, trainViews: 28, completed: false };
beforeEach(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile); });
afterEach(() => { brushPreviewRuntime.disconnect(); vi.unstubAllGlobals(); });

describe('scan checkpoints', () => {
  it('retains solve results as required RAW data and automatically reads them back', async () => {
    const { host, files } = storage();
    await persistLatestCameraSolve(dataset(), host);
    expect([...files.keys()].every(key => key.startsWith('RAW/'))).toBe(true);
    const restored = await loadLatestCameraSolve(host);
    expect(restored?.id).toBe('solve-1');
    expect(restored?.files.map(file => file.webkitRelativePath)).toEqual(dataset().files.map(file => file.webkitRelativePath));
  });
  it('keeps the previous solved dataset if publishing a new manifest fails', async () => {
    const { host } = storage(); await persistLatestCameraSolve(dataset(), host);
    const write = host.writeFile;
    host.writeFile = async (folder, path, data) => path.endsWith('.json') ? false : write(folder, path, data);
    await expect(persistLatestCameraSolve({ ...dataset(), id: 'solve-2' }, host)).rejects.toThrow('manifest');
    expect((await loadLatestCameraSolve(host))?.id).toBe('solve-1');
  });
  it('restores checkpoint bytes, iteration and the corresponding training dataset', async () => {
    const { host } = storage(); const writer = new BrushCheckpointWriter(host, dataset().files, base);
    await writer.save(new Uint8Array([1, 2, 3]), step);
    const saved = await readBrushCheckpoint(host, 50);
    expect(saved?.manifest).toMatchObject(step);
    expect(saved?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect((await readCheckpointDataset(host, saved!.manifest)).map(file => file.webkitRelativePath)).toEqual(dataset().files.map(file => file.webkitRelativePath));
    expect(await readBrushCheckpoint(host, 51)).toBeNull();
  });
  it('leaves the previous checkpoint usable after an interrupted manifest write', async () => {
    const { host } = storage(); const writer = new BrushCheckpointWriter(host, dataset().files, base);
    await writer.save(new Uint8Array([1]), step);
    const write = host.writeFile;
    host.writeFile = async (folder, path, data) => path === BRUSH_CHECKPOINT_MANIFEST ? false : write(folder, path, data);
    await expect(writer.save(new Uint8Array([2]), { ...step, iteration: 1200 })).rejects.toThrow('publish');
    expect((await readBrushCheckpoint(host, 50))?.manifest.iteration).toBe(1050);
  });
  it('resumes restored splats and the saved step without restarting the camera solve', async () => {
    const { host } = storage(); await new BrushCheckpointWriter(host, dataset().files, base).save(new Uint8Array([7]), step);
    const starter = vi.fn(async () => ({ pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
      exportPly: vi.fn(async () => new Uint8Array([9])), finished: Promise.resolve() }));
    const manager = new BrushTrainingManager(starter);
    await manager.restoreSaved(host, 'project-a', 50);
    expect(manager.getSnapshot()).toMatchObject({ restored: true, training: { phase: 'paused', iteration: 1050 } });
    manager.resume();
    await vi.waitFor(() => expect(starter).toHaveBeenCalledOnce());
    const resume = starter.mock.calls[0][3] as { iteration: number; ply: File };
    expect(resume.iteration).toBe(1050);
    expect(new Uint8Array(await resume.ply.arrayBuffer())).toEqual(new Uint8Array([7]));
    manager.reset();
  });
  it('restores a finished splat for export without starting any GPU worker', async () => {
    const { host } = storage(); await new BrushCheckpointWriter(host, dataset().files, base).save(new Uint8Array([8]), { ...step, iteration: 6000, completed: true });
    const starter = vi.fn(); const manager = new BrushTrainingManager(starter);
    await manager.restoreSaved(host, 'project-a', 50);
    expect(manager.getSnapshot().training?.phase).toBe('completed');
    expect(await manager.exportPly()).toEqual(new Uint8Array([8]));
    expect(starter).not.toHaveBeenCalled(); manager.reset();
  });
});
