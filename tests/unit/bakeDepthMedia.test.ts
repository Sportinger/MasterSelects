import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { bakeDepthMedia } from '../../src/services/depthEstimation/bakeDepthMedia';
const mock = vi.hoisted(() => ({ bake: vi.fn(), hash: vi.fn(), importFile: vi.fn(), state: { files: [] as MediaFile[] } }));
vi.mock('../../src/services/depthEstimation/bakeDepthVideo', () => ({ bakeDepthVideo: mock.bake }));
vi.mock('../../src/services/project/mediaSourceValidation', () => ({ readMediaSourceFingerprint: mock.hash }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: {
  getState: () => ({ ...mock.state, importFile: mock.importFile }),
  setState: (update: (s: typeof mock.state) => Partial<typeof mock.state>) => Object.assign(mock.state, update(mock.state)),
} }));
const source = { id: 'source', type: 'video', url: 'blob:source', file: new File(['source'], 'source.mp4') } as MediaFile;
beforeEach(() => {
  vi.clearAllMocks(); mock.state.files = [source];
  mock.hash.mockResolvedValue('fingerprint'); mock.bake.mockResolvedValue(new Blob(['map']));
  mock.importFile.mockImplementation(async () => { const result = { id: 'depth', type: 'video', url: 'blob:depth' } as MediaFile;
    mock.state.files.push(result); return result; });
});
const options = () => ({ url: source.url, file: source.file, from: 5, to: 10, fps: 15, edge: 280,
  smoothing: .75, invert: false, signal: new AbortController().signal, progress: vi.fn() });
describe('depth bake media provenance', () => {
  it('imports the existing bake with durable metadata and a matching source fingerprint', async () => {
    const result = await bakeDepthMedia(source, 'depth.mp4', options(), () => true);
    expect(result.depthMap).toMatchObject({ sourceMediaId: 'source', sourceFingerprint: 'fingerprint', sourceStart: 5,
      sourceEnd: 10, fps: 15, nearIsWhite: true });
    expect(mock.state.files.find(item => item.id === 'source')?.fileHash).toBe('fingerprint');
    expect(mock.state.files.find(item => item.id === 'depth')?.depthMap).toEqual(result.depthMap);
    expect(mock.importFile).toHaveBeenCalledWith(expect.any(File), undefined, { forceCopyToProject: true });
  });
  it('does not import a bake after the source changes during inference', async () => {
    mock.bake.mockImplementation(async () => { mock.state.files = [{ ...source, url: 'replacement' }]; return new Blob(); });
    await expect(bakeDepthMedia(source, 'depth.mp4', options(), () => true)).rejects.toThrow('changed');
    expect(mock.importFile).not.toHaveBeenCalled();
  });
  it('keeps provenance but does not apply a result when the context changes during import', async () => {
    let current = true;
    mock.importFile.mockImplementation(async () => { const result = { id: 'depth', type: 'video' } as MediaFile;
      mock.state.files.push(result); current = false; return result; });
    await expect(bakeDepthMedia(source, 'depth.mp4', options(), () => current)).rejects.toThrow('changed');
    expect(mock.state.files.find(item => item.id === 'depth')?.depthMap?.sourceMediaId).toBe('source');
  });
});
