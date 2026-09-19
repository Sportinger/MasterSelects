import { afterEach, describe, expect, it, vi } from 'vitest';

async function importSettingsStoreWithMocks(
  persistedState?: Record<string, unknown>,
  persistedVersion = 0,
) {
  vi.resetModules();
  vi.doUnmock('../../src/stores/settingsStore');
  localStorage.clear();
  if (persistedState) {
    localStorage.setItem('masterselects-settings', JSON.stringify({
      state: persistedState,
      version: persistedVersion,
    }));
  }

  vi.doMock('../../src/services/project/ProjectFileService', () => ({
    projectFileService: {
      isProjectOpen: vi.fn(() => false),
      getProjectData: vi.fn(() => null),
      markDirty: vi.fn(),
      saveProject: vi.fn(async () => undefined),
      saveKeysFile: vi.fn(async () => undefined),
      loadKeysFile: vi.fn(async () => false),
    },
  }));
  vi.doMock('../../src/engine/featureFlags', () => ({
    flags: {
      useFullWebCodecsPlayback: false,
      disableHtmlPreviewFallback: false,
    },
  }));
  vi.doMock('../../src/services/logger', () => ({
    Logger: {
      create: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    },
  }));

  return import('../../src/stores/settingsStore');
}

describe('import settings defaults', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('leaves imported media at its original location by default', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().copyMediaToProject).toBe(false);

    useSettingsStore.getState().setCopyMediaToProject(true);

    expect(useSettingsStore.getState().copyMediaToProject).toBe(true);
  });

  it('turns the former persisted auto-copy default off once', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks({
      copyMediaToProject: true,
    });

    expect(useSettingsStore.getState().copyMediaToProject).toBe(false);
  });

  it('preserves an explicit choice after the default migration', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks({
      copyMediaToProject: true,
    }, 1);

    expect(useSettingsStore.getState().copyMediaToProject).toBe(true);
  });

  it('disables goo touch feedback by default and for existing installs', async () => {
    const freshStore = await importSettingsStoreWithMocks();

    expect(freshStore.useSettingsStore.getState().touchGooEnabled).toBe(false);

    const migratedStore = await importSettingsStoreWithMocks({
      touchGooEnabled: true,
    }, 2);

    expect(migratedStore.useSettingsStore.getState().touchGooEnabled).toBe(false);
  });

  it('preserves an explicit goo touch feedback choice after its migration', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks({
      touchGooEnabled: true,
    }, 3);

    expect(useSettingsStore.getState().touchGooEnabled).toBe(true);
  });
});
