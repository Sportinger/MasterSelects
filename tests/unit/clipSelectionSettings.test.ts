import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importSettingsStoreWithMocks() {
  vi.resetModules();
  vi.doUnmock('../../src/stores/settingsStore');
  vi.doMock('../../src/services/youtubeCredentialManager', () => ({
    youtubeCredentialManager: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
  }));
  vi.doMock('../../src/services/project/ProjectFileService', () => ({
    projectFileService: {
      getProjectData: vi.fn().mockReturnValue(null),
      isProjectOpen: vi.fn().mockReturnValue(false),
      markDirty: vi.fn(),
      saveProject: vi.fn().mockResolvedValue(undefined),
    },
  }));
  vi.doMock('../../src/services/logger', () => ({
    Logger: {
      create: vi.fn(() => ({ error: vi.fn(), info: vi.fn() })),
    },
  }));

  return import('../../src/stores/settingsStore');
}

describe('repeat-click clip selection setting', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to keeping selection and persists the optional toggle across hydration', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();
    expect(useSettingsStore.getState().deselectClipOnRepeatClick).toBe(false);
    useSettingsStore.getState().setDeselectClipOnRepeatClick(true);
    const saved = localStorage.getItem('masterselects-settings');
    expect(saved).not.toBeNull();
    useSettingsStore.setState({ deselectClipOnRepeatClick: false });
    localStorage.setItem('masterselects-settings', saved!);
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().deselectClipOnRepeatClick).toBe(true);
  });
});
