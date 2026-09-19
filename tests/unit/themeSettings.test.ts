import { afterEach, describe, expect, it, vi } from 'vitest';

async function importSettingsStoreWithMocks(
  persistedState?: Record<string, unknown>,
  persistedVersion = 2,
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

describe('theme settings', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('moves an already persisted Resolve theme back to Dark', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks({ theme: 'resolve' }, 1);

    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('rejects attempts to activate the retired Resolve theme', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    useSettingsStore.getState().setTheme('resolve');

    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('allows and persists Resolve only after the hidden unlock', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    useSettingsStore.getState().unlockResolveTheme();
    useSettingsStore.getState().setTheme('resolve');

    expect(useSettingsStore.getState().resolveThemeUnlocked).toBe(true);
    expect(useSettingsStore.getState().theme).toBe('resolve');

    const persisted = JSON.parse(localStorage.getItem('masterselects-settings') ?? '{}');
    expect(persisted.state.resolveThemeUnlocked).toBe(true);
    expect(persisted.state.theme).toBe('resolve');
  });
});
