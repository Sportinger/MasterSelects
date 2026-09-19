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

describe('automatic Mobile layout setting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is enabled by default and can be disabled', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().automaticMobileLayoutEnabled).toBe(true);
    useSettingsStore.getState().setAutomaticMobileLayoutEnabled(false);
    expect(useSettingsStore.getState().automaticMobileLayoutEnabled).toBe(false);
  });
});
