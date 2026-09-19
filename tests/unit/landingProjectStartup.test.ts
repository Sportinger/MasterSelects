import { describe, expect, it, vi } from 'vitest';
import { runToolbarProjectBootRestore } from '../../src/components/common/toolbar/toolbarProjectStartup';

describe('Start layout project boot', () => {
  it.each([
    'http://localhost:5173/landing-preview',
    'http://localhost:5173/landing',
    'http://landing.localhost:5173/',
  ])('restores the current project for disabled landing entry %s', async (url) => {
    const restoreLastProject = vi.fn(async () => true);
    const loadProjectToStores = vi.fn(async () => undefined);

    await expect(runToolbarProjectBootRestore({
      loadProjectToStores,
      restoreLastProject,
      url,
    })).resolves.toBe('restored');
    expect(restoreLastProject).toHaveBeenCalledOnce();
    expect(loadProjectToStores).toHaveBeenCalledOnce();
  });

  it.each([
    'http://localhost:5173/chat',
    'http://localhost:5173/editor',
  ])('restores the current project for a direct %s entry', async (url) => {
    const restoreLastProject = vi.fn(async () => true);
    const loadProjectToStores = vi.fn(async () => undefined);

    await expect(runToolbarProjectBootRestore({
      loadProjectToStores,
      restoreLastProject,
      url,
    })).resolves.toBe('restored');
    expect(restoreLastProject).toHaveBeenCalledOnce();
    expect(loadProjectToStores).toHaveBeenCalledOnce();
  });

});
