import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isUnwatchedDevServerPath } from '../../tools/devServerWatch';

const root = path.resolve('/repo');
const unwatched = (relative: string) => isUnwatchedDevServerPath(path.join(root, relative), root);

describe('dev server watch list', () => {
  it('keeps everything the editor, ?test= routes and tests/browser pages import', () => {
    for (const relative of [
      'src',
      'src/effects/types.ts',
      'index.html',
      'about/index.html',
      'public/favicon.ico',
      'tests',
      'tests/setup.ts',
      'tests/browser',
      'tests/browser/effect-lab/index.html',
      'tests/fixtures/flockApicFixtures.ts',
      'tests/helpers/nodeGraphHarness.ts',
      'tools',
      'tools/buildIdentity.ts',
      'tools/devBridge/vitePlugin.ts',
    ]) {
      expect(unwatched(relative), relative).toBe(false);
    }
  });

  it('skips docs, the docs site, scripts and tests the dev server never serves', () => {
    for (const relative of [
      'docs',
      'docs/Features/Effect-System.md',
      'docs-site/public/assets/effects/drift-lines.webp',
      'scripts/effect-docs.mjs',
      'functions/api/me.ts',
      'tests/unit',
      'tests/unit/effectStyles.test.ts',
      'tests/playwright/editor.spec.ts',
      'tools/native-helper/src/main.rs',
    ]) {
      expect(unwatched(relative), relative).toBe(true);
    }
  });

  it('never ignores paths outside the root', () => {
    expect(isUnwatchedDevServerPath(path.resolve(root, '../docs/a.md'), root)).toBe(false);
    expect(isUnwatchedDevServerPath(root, root)).toBe(false);
  });
});
