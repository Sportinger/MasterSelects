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

  return import('../../src/stores/settingsStore');
}

describe('guided replay settings store', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('exposes defaults and only lower-bounds the animation budget', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    expect(useSettingsStore.getState().guidedActionReplayVisualizationMode).toBe('concise');
    expect(useSettingsStore.getState().guidedActionReplayBudgetMs).toBe(3000);
    expect(useSettingsStore.getState().guidedActionReplayCompressionMode).toBe('family');

    useSettingsStore.getState().setGuidedActionReplayBudgetMs(-25);
    expect(useSettingsStore.getState().guidedActionReplayBudgetMs).toBe(0);

    useSettingsStore.getState().setGuidedActionReplayBudgetMs(25000);
    expect(useSettingsStore.getState().guidedActionReplayBudgetMs).toBe(25000);

    useSettingsStore.getState().setGuidedActionReplayBudgetMs(Number.NaN);
    expect(useSettingsStore.getState().guidedActionReplayBudgetMs).toBe(3000);
  });

  it('updates replay visualization and compression modes', async () => {
    const { useSettingsStore } = await importSettingsStoreWithMocks();

    useSettingsStore.getState().setGuidedActionReplayVisualizationMode('full');
    useSettingsStore.getState().setGuidedActionReplayCompressionMode('aggressive');

    expect(useSettingsStore.getState().guidedActionReplayVisualizationMode).toBe('full');
    expect(useSettingsStore.getState().guidedActionReplayCompressionMode).toBe('aggressive');
  });
});
