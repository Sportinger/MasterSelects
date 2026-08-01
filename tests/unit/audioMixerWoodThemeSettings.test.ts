import { afterEach, describe, expect, it, vi } from 'vitest';

async function importSettingsStoreWithMocks() {
  vi.resetModules();
  vi.doUnmock('../../src/stores/settingsStore');
  localStorage.clear();

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

describe('audio mixer wood theme settings', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('disables the wooden mixer theme by default and lets users enable it', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().audioMixerWoodThemeEnabled).toBe(false);
    expect(useSettingsStore.getState().mediaPanelWoodThemeEnabled).toBe(false);

    useSettingsStore.getState().setAudioMixerWoodThemeEnabled(true);

    expect(useSettingsStore.getState().audioMixerWoodThemeEnabled).toBe(true);
  });
});
