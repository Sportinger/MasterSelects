import { afterEach, describe, expect, it, vi } from 'vitest';

const emptyKeys = {
  openai: '',
  anthropic: '',
  assemblyai: '',
  deepgram: '',
  piapi: '',
  kieai: '',
  evolink: '',
  elevenlabs: '',
  youtube: '',
  klingAccessKey: '',
  klingSecretKey: '',
};

async function importSettingsStoreWithMocks() {
  vi.resetModules();
  vi.doUnmock('../../src/stores/settingsStore');
  localStorage.clear();
  const mockedFlags = {
    useFullWebCodecsPlayback: false,
    disableHtmlPreviewFallback: false,
    workerFirstRenderHost: false,
  };

  vi.doMock('../../src/services/apiKeyManager', () => ({
    apiKeyManager: {
      storeKeyByType: vi.fn(async () => undefined),
      getAllKeys: vi.fn(async () => emptyKeys),
    },
  }));
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
    flags: mockedFlags,
  }));
  vi.doMock('../../src/services/lemonadeProvider', () => ({
    DEFAULT_LEMONADE_ENDPOINT: 'http://localhost:13305/api/v1',
    DEFAULT_LEMONADE_MODEL: 'local-model',
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

  return {
    ...(await import('../../src/stores/settingsStore')),
    mockedFlags,
  };
}

describe('audio mixer wood theme settings', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('enables the wooden mixer theme by default and lets users disable it', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().audioMixerWoodThemeEnabled).toBe(true);

    useSettingsStore.getState().setAudioMixerWoodThemeEnabled(false);

    expect(useSettingsStore.getState().audioMixerWoodThemeEnabled).toBe(false);
  });

  it('keeps worker WebCodecs playback disabled and worker render host enabled', async () => {
    const { useSettingsStore, mockedFlags } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().webCodecsEnabled).toBe(false);

    useSettingsStore.getState().setWebCodecsEnabled(true);

    expect(useSettingsStore.getState().webCodecsEnabled).toBe(false);
    expect(mockedFlags).toMatchObject({
      useFullWebCodecsPlayback: false,
      disableHtmlPreviewFallback: false,
      workerFirstRenderHost: true,
    });
  });
});
