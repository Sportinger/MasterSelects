import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { SCAN_SOURCE_MANIFEST, readScanSources, type ScanSourceStorage } from '../../src/services/photogrammetry/scanSourceProjectStorage';
import { ScanSourceManager } from '../../src/services/photogrammetry/ScanSourceManager';

vi.mock('../../src/services/photogrammetry/scanSourceAnalysis', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/services/photogrammetry/scanSourceAnalysis')>();
  return { ...original,
    analyzeScanImages: vi.fn(async (files: File[]) => files.map(file => ({ key: original.scanSourceKey(file), file,
      width: 2160, height: 3840, megapixels: 8.2944, quality: 'good', note: 'Ready' }))),
    createScanSourcePreview: vi.fn(async () => `blob:thumbnail-${crypto.randomUUID()}`),
  };
});

function memoryStorage() {
  const files = new Map<string, File>();
  const writes: string[] = [];
  const storage: ScanSourceStorage = {
    readFile: vi.fn(async (folder, name) => files.get(`${folder}/${name}`) ?? null),
    writeFile: vi.fn(async (folder, name, data) => {
      writes.push(`${folder}/${name}`);
      files.set(`${folder}/${name}`, new File([data], name));
      return true;
    }),
    deleteFile: vi.fn(async (folder, name) => { files.delete(`${folder}/${name}`); return true; }),
  };
  return { storage, files, writes };
}
const photo = (name = 'portrait-001.jpg', bytes = 'original jpeg bytes') => new File([bytes], name, { type: 'image/jpeg', lastModified: 1234 });
beforeEach(() => { vi.stubGlobal('File', NodeFile); vi.stubGlobal('Blob', NodeBlob); });

describe('project-backed scan source photos', () => {
  it('restores original bytes, metadata, order and timestamps before any camera solve', async () => {
    const { storage, writes } = memoryStorage();
    const first = new ScanSourceManager(); await first.activate(storage, 'project-a');
    await first.append([photo('z.jpg')], { sourceClipId: 'clip', sampleTimes: [0.1] }, 'video');
    await first.append([photo('a.jpg')], { sourceClipId: 'clip', sampleTimes: [0.4] }, 'video');
    const restored = new ScanSourceManager(); await restored.activate(storage, 'project-a-reopened');
    expect(restored.getSnapshot().photos.map(row => row.file.name)).toEqual(['z.jpg', 'a.jpg']);
    expect(restored.getSnapshot().source?.sampleTimes).toEqual([0.1, 0.4]);
    const file = restored.getSnapshot().photos[0].file;
    expect(await file.text()).toBe('original jpeg bytes');
    expect([file.type, file.lastModified]).toEqual(['image/jpeg', 1234]);
    expect(restored.getSnapshot()).toMatchObject({ persistence: 'project', busy: false, error: null });
    expect(writes.filter(path => path !== `RAW/${SCAN_SOURCE_MANIFEST}`)).toHaveLength(2);
    expect(writes[1]).toBe(`RAW/${SCAN_SOURCE_MANIFEST}`);
  });

  it('does not lose concurrent photo additions or duplicate retained sources', async () => {
    const { storage } = memoryStorage(); const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    await Promise.all([manager.append([photo('first.jpg')]), manager.append([photo('second.jpg')])]);
    await manager.append([photo('first.jpg')]);
    expect((await readScanSources(storage)).files.map(row => row.file.name)).toEqual(['first.jpg', 'second.jpg']);
  });

  it('persists removal and an empty set instead of resurrecting photos on reload', async () => {
    const { storage, files } = memoryStorage(); const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    await manager.append([photo('one.jpg'), photo('two.jpg')]);
    await manager.remove(manager.getSnapshot().photos[0].key);
    expect((await readScanSources(storage)).files.map(row => row.file.name)).toEqual(['two.jpg']);
    await manager.remove();
    expect((await readScanSources(storage)).files).toEqual([]);
    expect([...files.keys()]).toEqual([`RAW/${SCAN_SOURCE_MANIFEST}`]);
  });

  it('keeps the last saved capture intact when publishing the next manifest fails and allows retry', async () => {
    const { storage } = memoryStorage(); const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    await manager.append([photo('one.jpg')]);
    const write = storage.writeFile;
    storage.writeFile = vi.fn(async (folder, name, data) => name === SCAN_SOURCE_MANIFEST ? false : write(folder, name, data));
    await expect(manager.append([photo('two.jpg')])).rejects.toThrow('Could not save the scan source list');
    expect(manager.getSnapshot()).toMatchObject({ persistence: 'error', busy: false });
    expect((await readScanSources(storage)).files).toHaveLength(1);
    storage.writeFile = write; await manager.retry();
    expect((await readScanSources(storage)).files).toHaveLength(2);
    expect(manager.getSnapshot().persistence).toBe('project');
  });

  it('does not publish a manifest when image bytes cannot be written', async () => {
    const { storage, files } = memoryStorage(); const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    vi.mocked(storage.writeFile).mockResolvedValue(false);
    await expect(manager.append([photo()])).rejects.toThrow('Could not save scan photo');
    expect(files.size).toBe(0);
    expect(manager.getSnapshot().photos).toHaveLength(1);
  });

  it('pins delayed writes to the original project and cancels stale extraction', async () => {
    const a = memoryStorage(); const b = memoryStorage();
    const manager = new ScanSourceManager(); await manager.activate(a.storage, 'a');
    const signal = manager.signal;
    let complete!: () => void; let started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const write = a.storage.writeFile;
    a.storage.writeFile = async (...args) => { started(); await new Promise<void>(resolve => { complete = resolve; }); return write(...args); };
    const pending = manager.append([photo()]);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await began; await manager.activate(b.storage, 'b'); complete(); await rejection;
    expect(signal.aborted).toBe(true);
    expect(b.files.size).toBe(0);
    expect(manager.getSnapshot().photos).toEqual([]);
    expect(a.files.has(`RAW/${SCAN_SOURCE_MANIFEST}`)).toBe(false);
  });

  it('does not overwrite an unreadable saved capture with a new empty set', async () => {
    const { storage, files } = memoryStorage();
    files.set(`RAW/${SCAN_SOURCE_MANIFEST}`, new File(['{broken'], 'manifest.json'));
    const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    expect(manager.getSnapshot().persistence).toBe('error');
    await expect(manager.append([photo()])).rejects.toThrow('Restore the saved scan sources');
    expect(storage.writeFile).not.toHaveBeenCalled();
  });

  it('reports missing stored image bytes instead of silently dropping sources', async () => {
    const { storage, files } = memoryStorage(); const manager = new ScanSourceManager(); await manager.activate(storage, 'a');
    await manager.append([photo()]);
    files.delete([...files.keys()].find(key => !key.endsWith('manifest.json'))!);
    const restored = new ScanSourceManager(); await restored.activate(storage, 'reopen');
    expect(restored.getSnapshot().error).toContain('missing or incomplete');
    expect(restored.getSnapshot().persistence).toBe('error');
  });

  it('keeps memory-only captures visibly unsaved when no project is open', async () => {
    const manager = new ScanSourceManager(); await manager.append([photo()]);
    expect(manager.getSnapshot()).toMatchObject({ persistence: 'memory', error: null });
    expect(manager.getSnapshot().photos).toHaveLength(1);
  });
});
