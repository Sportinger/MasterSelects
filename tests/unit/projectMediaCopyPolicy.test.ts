import { beforeEach, describe, expect, it, vi } from 'vitest';

// Imports are copied into the project whenever their link would not survive a
// reload - also in the browser recovery project, which is reopened after a reload.

const state = vi.hoisted(() => ({
  projectOpen: false,
  requiresCopies: false,
  session: null as object | null,
  publication: null as object | null,
  durability: 'durable' as 'durable' | 'not-durable' | 'unknown',
  copying: true,
}));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => state.projectOpen,
    requiresProjectLocalMediaCopies: () => state.requiresCopies,
  },
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => state.session,
}));
vi.mock('../../src/services/project/repository/artifacts/RepositoryDomainPublication', () => ({
  captureRepositoryDomainPublication: () => state.publication,
}));
vi.mock('../../src/services/project/mediaCopy/mediaLinkDurability', () => ({
  probeMediaLinkDurability: async () => state.durability,
  isCopyingUndurableMedia: () => state.copying,
}));

import { canStoreProjectMedia, decideProjectMediaCopy, runProjectMediaCopy } from '../../src/services/project/mediaCopy/projectMediaCopyPolicy';
import {
  beginProjectMediaCopy, dismissProjectMediaCopyNotice, getProjectMediaCopyNotice, hasPendingProjectMediaCopies, isQuietProjectMediaCopyNotice,
} from '../../src/services/project/mediaCopy/projectMediaCopyNotices';

const handle = {} as FileSystemHandle;

describe('project media copy policy', () => {
  beforeEach(() => {
    Object.assign(state, { projectOpen: false, requiresCopies: false, session: null, publication: null, durability: 'durable', copying: true });
  });

  it('stores media in the browser recovery project, not only in named projects', async () => {
    expect(canStoreProjectMedia()).toBe(false);
    state.session = {}; state.publication = {};
    expect(canStoreProjectMedia()).toBe(true);
    expect(await decideProjectMediaCopy({ copySetting: false })).toEqual({ copy: true, reason: 'file-without-location', linkedByChoice: false });
  });

  it('keeps links that survive a reload and native paths', async () => {
    state.projectOpen = true;
    expect(await decideProjectMediaCopy({ copySetting: false, handle })).toMatchObject({ copy: false, reason: null });
    expect(await decideProjectMediaCopy({ copySetting: false, absolutePath: '/media/a.mov' })).toMatchObject({ copy: false });
  });

  it('copies linked files when this browser cannot store handles', async () => {
    state.projectOpen = true; state.durability = 'not-durable';
    expect(await decideProjectMediaCopy({ copySetting: false, handle })).toEqual({ copy: true, reason: 'links-not-durable', linkedByChoice: false });
  });

  it('lets the user keep such media linked, but never overrides the copy setting or forced copies', async () => {
    state.projectOpen = true; state.durability = 'not-durable'; state.copying = false;
    expect(await decideProjectMediaCopy({ copySetting: false, handle })).toEqual({ copy: false, reason: 'links-not-durable', linkedByChoice: true });
    expect(await decideProjectMediaCopy({ copySetting: true, handle })).toMatchObject({ copy: true, reason: 'setting' });
    expect(await decideProjectMediaCopy({ copySetting: false, force: true })).toMatchObject({ copy: true, reason: 'forced' });
  });

  it('announces a background copy while it runs (the page asks before leaving) and does not offer linking for it', async () => {
    dismissProjectMediaCopyNotice();
    let finish!: (value: string) => void;
    const running = runProjectMediaCopy({ name: 'phone.mp4', size: 30 }, { copy: true, reason: 'forced', linkedByChoice: false },
      () => new Promise<string>((resolve) => { finish = resolve; }), { announce: true });
    expect(hasPendingProjectMediaCopies()).toBe(true);
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 1, pendingBytes: 30, durabilityFiles: 0 });
    finish('Raw/phone.mp4');
    await expect(running).resolves.toBe('Raw/phone.mp4');
    expect(hasPendingProjectMediaCopies()).toBe(false);
    expect(getProjectMediaCopyNotice()).toMatchObject({ pendingFiles: 0, copiedFiles: 1 });
    dismissProjectMediaCopyNotice();
  });

  // A lingering "Copied into project" toast after every phone import covered the Library rows and the
  // source sheet's placement modes, so the next tap hit the toast (m7-media-source phone journeys).
  it('treats finished background copies as quiet, but never a running copy, a durability copy, a linked file or a failure', () => {
    dismissProjectMediaCopyNotice();
    const background = beginProjectMediaCopy({ name: 'phone.mp4', size: 30 }, true, 'background');
    expect(isQuietProjectMediaCopyNotice(getProjectMediaCopyNotice()), 'a running copy still shows').toBe(false);
    background.done();
    expect(isQuietProjectMediaCopyNotice(getProjectMediaCopyNotice())).toBe(true);
    dismissProjectMediaCopyNotice();

    beginProjectMediaCopy({ name: 'safari.mp4', size: 30 }, true, 'durability').done();
    expect(isQuietProjectMediaCopyNotice(getProjectMediaCopyNotice()), 'a durability copy explains itself').toBe(false);
    dismissProjectMediaCopyNotice();

    beginProjectMediaCopy({ name: 'broken.mp4', size: 30 }, true, 'background').fail(new Error('browser storage is full'));
    expect(isQuietProjectMediaCopyNotice(getProjectMediaCopyNotice()), 'a failure is always reported').toBe(false);
    dismissProjectMediaCopyNotice();
    expect(isQuietProjectMediaCopyNotice(null)).toBe(false);
  });

  it('does not copy when no project storage is open', async () => {
    state.durability = 'not-durable';
    expect(await decideProjectMediaCopy({ copySetting: true, handle })).toEqual({ copy: false, reason: null, linkedByChoice: false });
  });
});
