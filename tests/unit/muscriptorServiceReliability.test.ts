import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MuscriptorService } from '../../src/services/muscriptor/MuscriptorService';
import { useMuscriptorStore } from '../../src/stores/muscriptorStore';

const nativeHelperMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
}));

vi.mock('../../src/services/nativeHelper/NativeHelperClient', () => ({
  NativeHelperClient: {
    muscriptor: { cancel: nativeHelperMocks.cancel },
  },
}));

describe('MuscriptorService cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMuscriptorStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hard-cancels before a provider job id arrives and marks the sidecar for restart', async () => {
    const state = useMuscriptorStore.getState();
    state.setEnvironment({ modelsDownloaded: ['small'], serverPort: 9900 });
    state.setSetupStatus('ready');
    state.setJobState({ isProcessing: true, jobId: null, jobProgress: 1 });
    nativeHelperMocks.cancel.mockResolvedValue({ restartRequired: true });

    await expect(new MuscriptorService().cancel()).resolves.toBe(true);

    expect(nativeHelperMocks.cancel).toHaveBeenCalledWith('__active__');
    expect(useMuscriptorStore.getState()).toMatchObject({
      isProcessing: false,
      jobId: null,
      jobProgress: 0,
      serverPort: null,
      setupStatus: 'installed',
    });
  });
});
