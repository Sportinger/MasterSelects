import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function readSource(repoPath: string): string {
  return readFileSync(path.join(repoRoot, repoPath), 'utf8');
}

describe('export render host port boundary', () => {
  const migratedExportPaths = [
    'src/engine/export/ExportRenderSessionImpl.ts',
    'src/engine/export/ExportMaskTextures.ts',
    'src/engine/export/preloadGaussianSplats.ts',
  ];

  it('keeps export render callers behind the export render host port', () => {
    for (const repoPath of migratedExportPaths) {
      const source = readSource(repoPath);

      expect(source, repoPath).toContain('exportRenderHostPort');
      expect(source, repoPath).not.toMatch(/(?:from\s+['"][^'"]*WebGPUEngine|import\(['"][^'"]*WebGPUEngine)/);
      expect(source, repoPath).not.toMatch(/\bengine\./);
    }
  });

  it('keeps the engine singleton import isolated to the export render host port', () => {
    const source = readSource('src/engine/export/exportRenderHostPort.ts');

    expect(source).toMatch(/from\s+['"]\.\.\/WebGPUEngine['"]/);
  });
});
