// A phone import places its clip before the copy into the project is durable; these cases pin what
// happens when that background copy settles: the media switch to the project copy (file, URL, project
// path), a failure is marked and reported (never silent), and media that changed meanwhile are left alone.
import { beforeEach, describe, expect, it } from 'vitest';
import { switchToProjectCopyWhenDurable } from '../../src/stores/mediaStore/slices/fileImport/backgroundProjectCopy';
import type { MediaFile, MediaState } from '../../src/stores/mediaStore/types';
import type { ProjectCopySource } from '../../src/stores/mediaStore/helpers/importPipeline';
import { beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice } from '../../src/services/project/mediaCopy/projectMediaCopyNotices';
import { RepositoryError } from '../../src/services/project/repository/contracts';

function harness(original: File) {
  let state = {
    files: [{ id: 'm1', name: original.name, type: 'video', file: original, url: 'blob:original', projectCopy: 'copying' } as unknown as MediaFile],
  } as unknown as MediaState;
  const set = (patch: Partial<MediaState> | ((current: MediaState) => Partial<MediaState>)) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  };
  const get = () => state;
  const media = () => state.files.find((file) => file.id === 'm1')!;
  return { set, get, media, replace(next: Partial<MediaFile>) { set((current) => ({ files: current.files.map((file) => ({ ...file, ...next })) })); } };
}

const createUrl = async (_id: string, file: File) => `blob:copy-of-${file.name}`;

describe('background project copy completion', () => {
  beforeEach(() => {
    // A settled notice with failures stays until dismissed; start every case clean.
    const notice = getProjectMediaCopyNotice();
    if (notice) dismissProjectMediaCopyNotice();
  });

  it('switches the media to the durable project copy', async () => {
    const original = new File(['bytes'], 'clip.mp4');
    const copy = new File(['bytes'], 'clip.mp4');
    const store = harness(original);
    const copied: ProjectCopySource = { file: copy, relativePath: 'Raw/clip.mp4' };

    const outcome = await switchToProjectCopyWhenDurable(store.set, store.get, 'm1', original, Promise.resolve(copied), { createUrl });

    expect(outcome).toBe('switched');
    expect(store.media()).toMatchObject({ file: copy, url: 'blob:copy-of-clip.mp4', projectPath: 'Raw/clip.mp4', hasFileHandle: true });
    expect(store.media().projectCopy).toBeUndefined();
  });

  it('marks the media when the copy failed (the copy itself already reported why)', async () => {
    const original = new File(['bytes'], 'clip.mp4');
    const store = harness(original);

    const outcome = await switchToProjectCopyWhenDurable(store.set, store.get, 'm1', original, Promise.resolve(null), { createUrl });

    expect(outcome).toBe('failed');
    expect(store.media()).toMatchObject({ file: original, url: 'blob:original', projectCopy: 'failed' });
    expect(store.media().projectPath).toBeUndefined();
  });

  it('reports a failure after the copy (opening it, storing its handle) instead of losing it', async () => {
    const original = new File(['bytes'], 'late.mp4');
    const store = harness(original);

    const outcome = await switchToProjectCopyWhenDurable(store.set, store.get, 'm1', original,
      Promise.reject(new Error('handle could not be stored')), { createUrl });

    expect(outcome).toBe('failed');
    expect(store.media().projectCopy).toBe('failed');
    expect(getProjectMediaCopyNotice()?.failures).toEqual([{ name: 'late.mp4', bytes: original.size, message: 'handle could not be stored' }]);
  });

  it('leaves media alone that were replaced while the copy ran', async () => {
    const original = new File(['bytes'], 'clip.mp4');
    const replacement = new File(['other'], 'other.mp4');
    const store = harness(original);
    let finish!: (value: ProjectCopySource) => void;
    const pending = new Promise<ProjectCopySource>((resolve) => { finish = resolve; });

    const outcome = switchToProjectCopyWhenDurable(store.set, store.get, 'm1', original, pending, { createUrl });
    store.replace({ file: replacement, url: 'blob:replacement' });
    finish({ file: new File(['bytes'], 'clip.mp4'), relativePath: 'Raw/clip.mp4' });

    await expect(outcome).resolves.toBe('stale');
    expect(store.media()).toMatchObject({ file: replacement, url: 'blob:replacement' });
    expect(store.media().projectPath).toBeUndefined();
  });

  // A read-only tab, a failed storage worker or an editor out of sync with its project throw 'ownership' for
  // as long as the project stays open. Only an open transaction or a running Undo/Redo is worth waiting for.
  it('fails visibly on an ownership error that will not go away, instead of waiting forever', async () => {
    const original = new File(['bytes'], 'clip.mp4');
    const store = harness(original);
    const set: typeof store.set = (patch) => {
      if (typeof patch === 'function' && patch(store.get()).files?.some((file) => file.projectPath)) {
        throw new RepositoryError('ownership', 'This project is open read-only in this tab');
      }
      store.set(patch);
    };
    const ticket = beginProjectMediaCopy(original, true, 'background');
    const outcome = switchToProjectCopyWhenDurable(set, store.get, 'm1', original,
      Promise.resolve({ file: new File(['bytes'], 'clip.mp4'), relativePath: 'Raw/clip.mp4', ticket }), { createUrl });

    await expect(Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 50))])).resolves.toBe('failed');
    expect(store.media()).toMatchObject({ file: original, projectCopy: 'failed' });
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 0 });
    expect(getProjectMediaCopyNotice()?.failures).toEqual([{ name: 'clip.mp4', bytes: original.size, message: 'This project is open read-only in this tab' }]);
  });
});
