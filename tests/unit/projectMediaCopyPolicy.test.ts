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

import { canStoreProjectMedia, decideProjectMediaCopy } from '../../src/services/project/mediaCopy/projectMediaCopyPolicy';

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

  it('does not copy when no project storage is open', async () => {
    state.durability = 'not-durable';
    expect(await decideProjectMediaCopy({ copySetting: true, handle })).toEqual({ copy: false, reason: null, linkedByChoice: false });
  });
});
