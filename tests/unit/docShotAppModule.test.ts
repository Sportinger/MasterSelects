import { afterEach, describe, expect, it, vi } from 'vitest';
import { appModuleUrl } from '../../scripts/docShotSettings.mjs';

// The docs scripts run this inside the editor page; here the page runs it in place.
const page = { evaluate: <A, R>(run: (arg: A) => R, arg: A) => run(arg) };
const serve = (source: string) => vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => source })));

afterEach(() => vi.unstubAllGlobals());

describe('docs scripts reach the editor’s own module copy', () => {
  it('uses the ?t= URL Vite gives a module after an edit, so a store change reaches the editor', async () => {
    serve('import { useSettingsStore } from "/src/stores/settingsStore.ts?t=1792637993595";\nimport "/src/stores/settingsStoreExtra.ts";');
    expect(await appModuleUrl(page, '/src/stores/settingsStore.ts', '/src/hooks/useTheme.ts')).toBe('/src/stores/settingsStore.ts?t=1792637993595');
  });

  it('keeps the plain path when the module was never edited or the importer does not import it', async () => {
    serve('import { useSettingsStore } from "/src/stores/settingsStore.ts";');
    expect(await appModuleUrl(page, '/src/stores/settingsStore.ts', '/src/hooks/useTheme.ts')).toBe('/src/stores/settingsStore.ts');
    expect(await appModuleUrl(page, '/src/stores/dockStore/index.ts', '/src/hooks/useTheme.ts')).toBe('/src/stores/dockStore/index.ts');
  });
});
