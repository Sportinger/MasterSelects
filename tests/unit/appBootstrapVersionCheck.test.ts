import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../public/app-bootstrap.js'), 'utf8');

function boot(servedVersion: string, storedVersion: string | null) {
  const store = new Map<string, string>(storedVersion ? [['app_version', storedVersion]] : []);
  const reload = vi.fn();
  const deleteCache = vi.fn();
  const log = vi.fn();
  const fakeWindow = { location: { reload, search: '', pathname: '/editor', hash: '' }, caches: {} };
  const fakeDocument = {
    querySelector: (selector: string) => (selector === 'meta[name="app-version"]'
      ? { getAttribute: () => servedVersion } : null),
  };
  const localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) };
  const caches = { keys: async () => ['masterselects-roto-sam21-v1'], delete: deleteCache };
  new Function('window', 'document', 'localStorage', 'caches', 'console', source)(
    fakeWindow, fakeDocument, localStorage, caches, { log },
  );
  return { reload, deleteCache, log, stored: store.get('app_version') };
}

describe('app bootstrap version check', () => {
  // A stale-tab recovery reload (chunkLoadRecovery) used to be followed by a second,
  // bootstrap reload, and every deploy wiped the downloaded AI models in Cache Storage.
  it('records a new version without reloading again or clearing Cache Storage', async () => {
    const result = boot('3.2.6', '3.2.5');
    await Promise.resolve();
    expect(result.log).toHaveBeenCalledWith('[Version] Update detected:', '3.2.5', '->', '3.2.6');
    expect(result.stored).toBe('3.2.6');
    expect(result.reload).not.toHaveBeenCalled();
    expect(result.deleteCache).not.toHaveBeenCalled();
  });

  it('cannot ping-pong between two builds served alternately during a deploy', () => {
    expect(boot('3.2.5', '3.2.6').reload).not.toHaveBeenCalled();
    expect(boot('3.2.6', null).stored).toBe('3.2.6');
  });

  it('skips the check in a raw dev checkout', () => {
    expect(boot('__APP_VERSION__', '3.2.5').stored).toBe('3.2.5');
  });
});
