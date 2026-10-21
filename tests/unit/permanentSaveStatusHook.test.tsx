import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  location: { kind: 'opfs', path: 'Stage Show', store: 'opfs' } as Record<string, unknown> | null,
  homeScreen: 'browser-tab' as 'none' | 'browser-tab' | 'home-screen-app',
  persisted: vi.fn(async () => false),
}));
vi.mock('../../src/services/project/repository/lifecycle/editorRepositoryLifecycle', () => ({
  getActiveRepositorySession: () => (state.location ? { location: state.location } : null),
  isScratchRepository: () => false,
  subscribeRepositoryLifecycle: () => () => {},
}));
vi.mock('../../src/services/project/core/browserStorageRoot', () => ({
  isBrowserStorageFallbackActive: () => false,
  subscribeBrowserStorageKind: () => () => {},
  resolveBrowserStore: (store?: string) => store ?? 'opfs',
}));
vi.mock('../../src/services/project/permanentSave/browserStorageMigration', () => ({
  listTemporaryProjects: async () => [],
  canUsePersistentBrowserStorage: async () => true,
}));
vi.mock('../../src/utils/mobileAppleWebKit', () => ({ resolveAppleHomeScreenMode: () => state.homeScreen }));
import { usePermanentSaveStatus } from '../../src/components/common/toolbar/usePermanentSaveStatus';
import { shouldOfferPermanentSave } from '../../src/services/project/permanentSave/permanentSaveOptions';

describe('usePermanentSaveStatus on iPhone/iPad', () => {
  beforeEach(() => {
    state.location = { kind: 'opfs', path: 'Stage Show', store: 'opfs' };
    state.homeScreen = 'browser-tab';
    state.persisted.mockReset().mockResolvedValue(false);
    vi.stubGlobal('navigator', { ...navigator, storage: { persisted: state.persisted } });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('offers the hint for a browser-local project in a Safari tab whose storage is not persisted', async () => {
    const { result } = renderHook(() => usePermanentSaveStatus());
    expect(shouldOfferPermanentSave(result.current)).toBe(false);
    await waitFor(() => expect(result.current.persistence).toBe(false));
    expect(result.current.activeBrowserLocal).toBe(true);
    expect(shouldOfferPermanentSave(result.current)).toBe(true);
  });

  it('hides it once the browser persisted the storage', async () => {
    state.persisted.mockResolvedValue(true);
    const { result } = renderHook(() => usePermanentSaveStatus());
    await waitFor(() => expect(result.current.persistence).toBe(true));
    expect(shouldOfferPermanentSave(result.current)).toBe(false);
  });

  it('does not ask for persistence in the Home Screen app or for folder projects', async () => {
    state.homeScreen = 'home-screen-app';
    const app = renderHook(() => usePermanentSaveStatus());
    state.homeScreen = 'browser-tab';
    state.location = { kind: 'native-folder', path: '/projects/Stage Show' };
    const folder = renderHook(() => usePermanentSaveStatus());
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(state.persisted).not.toHaveBeenCalled();
    expect(shouldOfferPermanentSave(app.result.current)).toBe(false);
    expect(folder.result.current.activeBrowserLocal).toBe(false);
    expect(shouldOfferPermanentSave(folder.result.current)).toBe(false);
  });
});
