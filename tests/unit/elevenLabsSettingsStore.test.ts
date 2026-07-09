import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiKeyType } from '../../src/services/apiKeyManager';
import type { APIKeys } from '../../src/stores/settingsStore';

const emptyKeys: APIKeys = {
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

async function importSettingsStoreWithMocks(storedKeys: APIKeys = emptyKeys) {
  vi.resetModules();
  vi.doUnmock('../../src/stores/settingsStore');

  const storeKeyByType = vi.fn(async () => undefined);
  const getAllKeys = vi.fn(async () => storedKeys);
  const saveKeysFile = vi.fn(async () => undefined);
  const loadKeysFile = vi.fn(async () => false);

  vi.doMock('../../src/services/apiKeyManager', () => ({
    apiKeyManager: {
      storeKeyByType,
      getAllKeys,
    },
  }));
  vi.doMock('../../src/services/project/ProjectFileService', () => ({
    projectFileService: {
      isProjectOpen: vi.fn(() => false),
      getProjectData: vi.fn(() => null),
      markDirty: vi.fn(),
      saveProject: vi.fn(async () => undefined),
      saveKeysFile,
      loadKeysFile,
    },
  }));
  vi.doMock('../../src/engine/featureFlags', () => ({
    flags: {
      useFullWebCodecsPlayback: false,
      disableHtmlPreviewFallback: false,
    },
  }));
  vi.doMock('../../src/services/lemonadeProvider', () => ({
    DEFAULT_LEMONADE_ENDPOINT: 'http://localhost:13305/api/v1',
    DEFAULT_LEMONADE_CONTEXT_SIZE: -1,
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

  const settingsStore = await import('../../src/stores/settingsStore');
  return {
    ...settingsStore,
    storeKeyByType,
    getAllKeys,
    saveKeysFile,
    loadKeysFile,
  };
}

describe('ElevenLabs settings store API key wiring', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('accepts elevenlabs as an API key type', () => {
    const keyType: ApiKeyType = 'elevenlabs';

    expect(keyType).toBe('elevenlabs');
  });

  it('stores ElevenLabs keys through the encrypted apiKeyManager path', async () => {
    const { useSettingsStore, storeKeyByType, saveKeysFile } = await importSettingsStoreWithMocks();

    useSettingsStore.getState().setApiKey('elevenlabs', 'el-api-key');
    await Promise.resolve();
    await Promise.resolve();

    expect(useSettingsStore.getState().apiKeys.elevenlabs).toBe('el-api-key');
    expect(storeKeyByType).toHaveBeenCalledWith('elevenlabs', 'el-api-key');
    expect(saveKeysFile).not.toHaveBeenCalled();
  });

  it('stores EvoLink keys through the encrypted apiKeyManager path', async () => {
    const { useSettingsStore, storeKeyByType } = await importSettingsStoreWithMocks();

    useSettingsStore.getState().setApiKey('evolink', 'ev-api-key');
    await Promise.resolve();
    await Promise.resolve();

    expect(useSettingsStore.getState().apiKeys.evolink).toBe('ev-api-key');
    expect(storeKeyByType).toHaveBeenCalledWith('evolink', 'ev-api-key');
  });

  it('loads ElevenLabs keys from encrypted storage into settings state', async () => {
    const storedKeys: APIKeys = {
      ...emptyKeys,
      elevenlabs: 'loaded-el-key',
    };
    const { useSettingsStore, getAllKeys } = await importSettingsStoreWithMocks(storedKeys);

    await useSettingsStore.getState().loadApiKeys();

    expect(getAllKeys).toHaveBeenCalled();
    expect(useSettingsStore.getState().apiKeys.elevenlabs).toBe('loaded-el-key');
  });
});
