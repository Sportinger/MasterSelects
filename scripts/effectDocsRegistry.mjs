// The effect registry as plain data for the docs scripts (effect-docs.mjs, docs-media.mjs): the TypeScript
// registry is loaded through Vite's SSR module loader (no dev server, no config file, no browser).
import path from 'node:path';
import { snapshotRegistry } from './effectDocsCatalog.mjs';

export async function loadEffectSnapshot(root) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': path.join(root, 'src') } },
    define: { __APP_VERSION__: '"docs"', __SHOW_CHANGELOG__: 'false', __DEV_BRIDGE_TOKEN__: '""', __DEV_ALLOWED_FILE_ROOTS__: '[]' },
  });
  try {
    const effects = await server.ssrLoadModule('/src/effects/index.ts');
    const { catalogText } = await server.ssrLoadModule('/src/services/nodeGraph/catalogText.ts');
    const { effectParamDisplay } = await server.ssrLoadModule('/src/effects/paramDisplay.ts');
    return snapshotRegistry({
      effects: effects.getAllEffects(), groups: effects.EFFECT_GROUPS, hidden: effects.EFFECTS_HIDDEN_FROM_CATALOG,
      engineOf: effects.effectEngine, engineMembers: effects.effectEngineMembers, text: catalogText,
      display: effectParamDisplay, experimental: effects.effectExperimentalNote,
    });
  } finally {
    await server.close();
  }
}
