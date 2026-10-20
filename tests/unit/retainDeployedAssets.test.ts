import { describe, expect, it } from 'vitest';
import { extractAssetReferences } from '../../scripts/retain-deployed-assets.mjs';

describe('retained deploy assets', () => {
  it('finds every way a Vite build references hashed assets', () => {
    const entry = [
      'const App=()=>import("./App-DsNuWLcW.js");',
      'const deps=["assets/renderHostPort-Bm8Fb5yM.js","assets/ExportPanel-CxFn7j6S.css"];',
      'new URL("/assets/hapEncodeWorker-BTvv5m0k.js",import.meta.url);',
      '@font-face{src:url(/assets/Inter-AbCd1234.woff2)}',
      '<script type="module" src="/assets/editor-C1lU6MQe.js"></script>',
    ].join('\n');
    expect([...extractAssetReferences(entry)].toSorted()).toEqual([
      'App-DsNuWLcW.js',
      'ExportPanel-CxFn7j6S.css',
      'Inter-AbCd1234.woff2',
      'editor-C1lU6MQe.js',
      'hapEncodeWorker-BTvv5m0k.js',
      'renderHostPort-Bm8Fb5yM.js',
    ]);
  });

  it('ignores paths outside the asset directory', () => {
    expect([...extractAssetReferences('fetch("/api/me"); import("https://cdn.example/x.js"); "/docs/index.html"')]).toEqual([]);
  });
});
