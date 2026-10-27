// The phone project boot must not wait for the GPU: it resolves while the engine is still
// starting (here: an engine/render host that would never finish), and it does not even load the
// render host or the WebGPU context modules.
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ renderHost: false, webgpu: false, engine: false }));
const project = vi.hoisted(() => ({ open: false, loaded: vi.fn(async () => {}) }));

vi.mock('../../src/services/render/renderHostPort', () => {
  loaded.renderHost = true;
  return { renderHostPort: { initialize: () => new Promise(() => {}) } };
});
vi.mock('../../src/engine/core/WebGPUContext', () => {
  loaded.webgpu = true;
  return {};
});
vi.mock('../../src/engine/WebGPUEngine', () => {
  loaded.engine = true;
  return {};
});
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
vi.mock('../../src/components/common/toolbar/toolbarProjectStartup', () => ({
  runToolbarProjectBootRestore: async (input: { restoreLastProject: () => Promise<boolean>; loadProjectToStores: () => Promise<unknown> }) => {
    if (!await input.restoreLastProject()) return 'not-restored';
    await input.loadProjectToStores();
    return 'restored';
  },
}));
vi.mock('../../src/services/project/androidProjectAutoRestore', () => ({ restoreAndroidProjectAutomatically: async () => false }));
vi.mock('../../src/services/project/core/browserStorageFailure', () => ({
  BROWSER_STORAGE_UNAVAILABLE_MESSAGE: 'storage unavailable',
  describeBrowserStorageFailure: () => null,
}));
vi.mock('../../src/services/project/projectLifecycle', () => ({ teardownAutoSync: vi.fn() }));
vi.mock('../../src/services/projectDB', () => ({ projectDB: { hasInitFailed: () => false, hasLastProject: async () => true } }));
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    isProjectOpen: () => project.open,
    needsPermission: () => false,
    loadProject: async () => false,
    restoreLastProject: async () => { project.open = true; return true; },
  },
}));
vi.mock('../../src/services/projectSync', () => ({
  loadProjectToStores: project.loaded,
  setProjectLoadProgress: vi.fn(),
  setupAutoSync: vi.fn(),
}));

import { usePhoneProjectBoot } from '../../src/components/mobileSkin/runtime/usePhoneProjectBoot';
import { readPhoneBootTimeline, resetPhoneBootTimelineForTests } from '../../src/components/mobileSkin/runtime/phoneBootTimeline';

afterEach(() => resetPhoneBootTimelineForTests());

describe('phone project boot without the GPU', () => {
  it('opens and hydrates the last project while the GPU never becomes ready', async () => {
    const { result } = renderHook(() => usePhoneProjectBoot());
    await waitFor(() => expect(result.current.bootPending).toBe(false));
    expect(result.current.projectOpen).toBe(true);
    expect(project.loaded).toHaveBeenCalledTimes(1);
    expect(readPhoneBootTimeline().map((mark) => mark.phase)).toEqual(['boot-start', 'repository-open', 'stores-hydrated']);
    expect(loaded, 'the boot path loaded a GPU module').toEqual({ renderHost: false, webgpu: false, engine: false });
  });
});
