import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('media panel async-update scrollbar policy', () => {
  it('keeps horizontal input scrolling without exposing Chromium native chrome', () => {
    const css = readWorkspaceFile('src/components/panels/MediaPanel.css');

    expect(css).toMatch(/\.media-panel-table-wrapper\s*\{[\s\S]*?overflow-x:\s*auto;/);
    expect(css).toMatch(
      /\.media-panel-table-wrapper::-webkit-scrollbar:horizontal\s*\{[\s\S]*?height:\s*0;/,
    );
    expect(css).not.toMatch(/media-panel-table-wrapper:hover::-webkit-scrollbar-thumb:horizontal/);
  });

  it('constrains the lazy AI tray placeholder to its panel rather than the viewport', () => {
    const css = readWorkspaceFile('src/components/panels/media/MediaAIGenerativeTray.css');
    const loadingRule = css.match(/\.media-ai-tray-loading\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(loadingRule).toContain('width: 100%');
    expect(loadingRule).toContain('max-width: 100%');
    expect(loadingRule).not.toContain('100vw');
  });
});
