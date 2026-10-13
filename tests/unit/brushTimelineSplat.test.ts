import { describe, expect, it, vi } from 'vitest';
import { BrushTimelineSplat, type BrushTimelineSplatDeps } from '../../src/services/photogrammetry/BrushTimelineSplat';
import type { BrushPreviewSnapshot } from '../../src/services/photogrammetry/brushPreviewRuntime';
import type { BrushTrainingJobSnapshot } from '../../src/services/photogrammetry/brushTrainingManager';
import type { MediaFile } from '../../src/stores/mediaStore';

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set(next: Partial<T>) { value = { ...value, ...next }; listeners.forEach(listener => listener()); },
  };
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function training(phase: string, iteration: number): BrushTrainingJobSnapshot['training'] {
  return { phase, iteration, totalIterations: 6000, splatCount: 1, trainViews: 28, evalViews: 0,
    elapsedMs: 0, psnr: null, ssim: null, warning: null } as BrushTrainingJobSnapshot['training'];
}

function setup() {
  const preview = Object.assign(store<BrushPreviewSnapshot>({ connected: true, updating: true, cameraPath: null,
    bytes: null, iteration: 0, revision: 0, error: null, warning: null }), { request: vi.fn() });
  const job = store<BrushTrainingJobSnapshot>({ datasetName: 'scan', preset: 'quality', training: training('training', 10),
    isStarting: false, error: null, checkpoint: { state: 'none', iteration: 0, savedAt: null, error: null }, restored: false });
  const media: MediaFile[] = [];
  const clips = new Map<string, string>(); // mediaFileId -> scene key
  let tick: () => void = () => {};
  const deps: BrushTimelineSplatDeps = {
    preview, training: job,
    importSplat: vi.fn(async (file: File) => {
      const entry = { id: `m${media.length + 1}`, name: file.name, type: 'gaussian-splat', file, url: `blob:${file.name}` } as MediaFile;
      media.push(entry); return entry;
    }),
    findMedia: id => media.find(entry => entry.id === id),
    findMediaByName: name => media.findLast(entry => entry.name === name),
    sceneKeysForMedia: id => clips.has(id) ? [clips.get(id)!] : [],
    sceneKeyForMedia: entry => `key:${entry.id}`,
    placeOnTimeline: vi.fn(async (_file: File, entry: MediaFile) => { clips.set(entry.id, `key:${entry.id}`); return `clip-${entry.id}`; }),
    repointClips: vi.fn((from: string, to: MediaFile, key: string) => {
      if (!clips.has(from)) return 0;
      clips.delete(from); clips.set(to.id, key); return 1;
    }),
    removeMediaIfUnused: vi.fn((id: string) => { if (!clips.has(id)) media.splice(media.findIndex(entry => entry.id === id), 1); }),
    replaceScene: vi.fn(async () => true),
    forgetScene: vi.fn(),
    requestRender: vi.fn(),
    log: vi.fn(),
    setInterval: (callback) => { tick = callback; return () => {}; },
    isDocumentVisible: () => true,
  };
  const live = new BrushTimelineSplat(deps);
  return { live, deps, preview, job, media, clips, tick: () => tick() };
}

describe('live training splat on the timeline', () => {
  it('places the first snapshot once, then swaps the GPU scene in place on later snapshots', async () => {
    const { live, deps, preview, media } = setup();
    const first = new Uint8Array([1]);
    preview.set({ bytes: first, iteration: 25, revision: 1 });
    await flush();
    expect(deps.importSplat).toHaveBeenCalledTimes(1);
    expect(media[0].name).toBe('scan-training.ply');
    expect(deps.placeOnTimeline).toHaveBeenCalledTimes(1);
    expect(deps.replaceScene).not.toHaveBeenCalled();
    expect(live.getSnapshot()).toMatchObject({ status: 'live', mediaFileId: 'm1', iteration: 25 });

    preview.set({ bytes: new Uint8Array([2]), iteration: 300, revision: 2 });
    await flush();
    expect(deps.placeOnTimeline).toHaveBeenCalledTimes(1);
    expect(deps.replaceScene).toHaveBeenCalledWith('key:m1', expect.any(File));
    expect(deps.requestRender).toHaveBeenCalled();
    expect(live.getSnapshot().iteration).toBe(300);
    live.dispose();
  });

  it('polls snapshots only while the live clip is visible', async () => {
    const { live, deps, preview, clips, tick } = setup();
    tick();
    expect(deps.preview.request).toHaveBeenCalledTimes(1); // first snapshot
    preview.set({ bytes: new Uint8Array([1]), iteration: 5, revision: 1 });
    await flush();
    tick();
    expect(deps.preview.request).toHaveBeenCalledTimes(2);
    clips.clear(); // user deleted the clip
    tick();
    expect(deps.preview.request).toHaveBeenCalledTimes(2);
    live.dispose();
  });

  it('moves the clip onto the final result and drops the intermediate media item', async () => {
    const { live, deps, preview, job, media, clips } = setup();
    preview.set({ bytes: new Uint8Array([1]), iteration: 25, revision: 1 });
    await flush();
    const finalBytes = new Uint8Array([9]);
    job.set({ training: training('completed', 6000) });
    preview.set({ bytes: finalBytes, iteration: 6000, revision: 2, updating: false });
    await flush();
    expect(media.map(entry => entry.name)).toEqual(['scan-trained.ply']);
    expect(clips.get('m2')).toBe('key:m2');
    // Uploaded before the clip switches, then kept as the clip's own scene.
    expect(deps.replaceScene).toHaveBeenLastCalledWith('key:m2', expect.any(File));
    expect(deps.forgetScene).toHaveBeenCalledWith('key:m2', false);
    expect(deps.forgetScene).toHaveBeenCalledWith('key:m1', true);
    expect(live.getSnapshot()).toMatchObject({ status: 'final', mediaFileId: 'm2' });
    live.dispose();
  });

  it('reattaches to an existing live clip after reload without adding another one', async () => {
    const { live, deps, preview, job, media, clips } = setup();
    media.push({ id: 'old', name: 'scan-training.ply', type: 'gaussian-splat', url: '' } as MediaFile);
    clips.set('old', 'key:old');
    job.set({ training: training('paused', 400), restored: true });
    preview.set({ bytes: new Uint8Array([4]), iteration: 400, revision: 1, updating: false });
    await flush();
    expect(deps.importSplat).not.toHaveBeenCalled();
    expect(deps.replaceScene).toHaveBeenCalledWith('key:old', expect.any(File));
    expect(live.getSnapshot()).toMatchObject({ status: 'live', mediaFileId: 'old', iteration: 400 });
    live.dispose();
  });

  it('never adds a clip for a restored snapshot and respects a deleted live media item', async () => {
    const { live, deps, preview, job, media } = setup();
    job.set({ training: training('paused', 400), restored: true });
    preview.set({ bytes: new Uint8Array([4]), iteration: 400, revision: 1, updating: false });
    await flush();
    expect(deps.importSplat).not.toHaveBeenCalled();

    job.set({ training: training('training', 410), restored: false });
    preview.set({ bytes: new Uint8Array([5]), iteration: 410, revision: 2, updating: true });
    await flush();
    expect(live.getSnapshot().status).toBe('live');
    media.length = 0; // user deleted the media item
    preview.set({ bytes: new Uint8Array([6]), iteration: 420, revision: 3 });
    await flush();
    expect(live.getSnapshot().status).toBe('removed');
    preview.set({ bytes: new Uint8Array([7]), iteration: 430, revision: 4 });
    await flush();
    expect(deps.importSplat).toHaveBeenCalledTimes(1);

    live.showOnTimeline();
    await flush();
    expect(deps.importSplat).toHaveBeenCalledTimes(2);
    expect(live.getSnapshot().status).toBe('live');
    live.dispose();
  });

  it('reports a failed placement instead of retrying silently', async () => {
    const { live, deps, preview } = setup();
    vi.mocked(deps.placeOnTimeline).mockRejectedValueOnce(new Error('no track'));
    preview.set({ bytes: new Uint8Array([1]), iteration: 5, revision: 1 });
    await flush();
    expect(live.getSnapshot()).toMatchObject({ status: 'error', error: 'no track' });
    expect(deps.log).toHaveBeenCalledWith('Live timeline splat failed', { error: 'no track' });
    preview.set({ bytes: new Uint8Array([2]), iteration: 10, revision: 2 });
    await flush();
    expect(deps.placeOnTimeline).toHaveBeenCalledTimes(1);
    live.dispose();
  });
});
