import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { buildCellGridFromPixels } from '../../src/effects/_shared/cellGrid';
import {
  buildCellGridSvg,
  buildCellGridText,
  buildCellGridWebPack,
} from '../../src/effects/_shared/cellGridArtifacts';

describe('cell-grid artifacts', () => {
  it('emits standalone text SVG rather than an embedded raster', () => {
    const grid = buildCellGridFromPixels(
      new Uint8ClampedArray([255, 255, 255, 255]),
      1,
      1,
      { columns: 1, cellAspectRatio: 1, customRamp: ' #' },
    );
    const svg = buildCellGridSvg(grid);
    expect(svg).toContain('<text');
    expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(svg).not.toContain('<image');
    expect(buildCellGridText(grid)).toBe('#\n');
  });

  it('adds an optional compressed tracking sidecar to the Web Pack', async () => {
    const grid = buildCellGridFromPixels(
      new Uint8ClampedArray([255, 255, 255, 255]),
      1,
      1,
      { columns: 1, cellAspectRatio: 1, customRamp: ' #' },
    );
    const bundle = await buildCellGridWebPack({
      basename: 'artifact',
      grid,
      trackingSidecar: { version: 1, frames: [] },
    });
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(bundle);
    });
    const files = unzipSync(new Uint8Array(arrayBuffer));
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'artifact.svg',
      'artifact.txt',
      'artifact.manifest.json',
      'artifact.tracking.json.gz',
    ]));
    expect(files['artifact.tracking.json.gz'].byteLength).toBeGreaterThan(0);
  });
});
