import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { particleBudgetNotes, particleGrid } from '../../src/effects/stylize/pixel-particle-disintegrate/budget';
import { RELEASE_QUANTILE_COUNT, RELEASE_SPREAD, rawReleaseDelay, releaseQuantiles, releaseWindow } from '../../src/effects/stylize/pixel-particle-disintegrate/releaseTiming';
import { withLegacyLookParams } from '../../src/effects/looks/legacyLookParams';
import { compileParticleDisintegrateGraph, createDefaultParticleDisintegrateGraph } from '../../src/services/operators/particleDisintegrateGraph';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import type { Effect } from '../../src/types/effects';

const defaults = () => getDefaultParams('pixel-particle-disintegrate') as Record<string, number | string | boolean>;

describe('Pixel Particle Disintegrate grid and budget', () => {
  it('cuts one particle per Cell Size cell while the budget allows it', () => {
    expect(particleGrid(defaults(), 1920, 1080, 'preview')).toMatchObject({ cellSize: 8, columns: 240, rows: 135, clampedByBudget: false });
    expect(particleBudgetNotes(defaults(), 1920, 1080)).toEqual([]);
  });

  it('cuts the same grid at every render size: Cell Size counts pixels of a 1080p frame', () => {
    // Half and quarter Preview Quality, 720p, 4K and 8K: one 240 x 135 grid, cells scaled to the frame.
    for (const [width, height, cellPixels] of [[960, 540, 4], [480, 270, 2], [1280, 720, 16 / 3], [3840, 2160, 16], [7680, 4320, 32]]) {
      for (const quality of ['preview', 'export'] as const) {
        expect(particleGrid(defaults(), width, height, quality), `${width} ${quality}`).toMatchObject({ cellSize: 8, columns: 240, rows: 135, clampedByBudget: false });
        expect(particleGrid(defaults(), width, height, quality).cellPixels).toBeCloseTo(cellPixels, 9);
      }
      expect(particleBudgetNotes(defaults(), width, height)).toEqual([]);
    }
    // Portrait frames scale by their shorter side, too.
    expect(particleGrid(defaults(), 1080, 1920, 'preview')).toMatchObject({ columns: 135, rows: 240 });
  });

  it('grows the cells until the grid fits the budget, never cutting rows off', () => {
    for (const [width, height] of [[3840, 2160], [4096, 2160], [2560, 1440], [3001, 1999], [7680, 4320]]) {
      for (const quality of ['preview', 'export'] as const) for (const params of [{ ...defaults(), cellSize: 2 }, { ...defaults(), cellReference: 'output' }]) {
        const grid = particleGrid(params, width, height, quality);
        // Every pixel lies in a cell: the grid covers the frame, and it stays within the budget.
        expect(grid.columns * grid.cellPixels).toBeGreaterThanOrEqual(width - 1e-6);
        expect(grid.rows * grid.cellPixels).toBeGreaterThanOrEqual(height - 1e-6);
        expect(grid.columns * grid.rows).toBeLessThanOrEqual(grid.budget);
        // The smallest cell size that fits: one unit less would not fit.
        const scale = grid.cellPixels / grid.cellSize, smaller = (grid.cellSize - 1) * scale;
        if (grid.clampedByBudget) expect(Math.ceil(width / smaller - 1e-9) * Math.ceil(height / smaller - 1e-9)).toBeGreaterThan(grid.budget);
      }
    }
  });

  it('says when preview and export draw different cells', () => {
    // Cell Size 2 (1080p px) needs 960 x 540 = 518,400 particles at any 16:9 size.
    const fine = { ...defaults(), cellSize: 2 };
    expect(particleGrid(fine, 960, 540, 'preview')).toMatchObject({ cellSize: 6, columns: 320, rows: 180, clampedByBudget: true, budget: 60000 });
    expect(particleGrid(fine, 3840, 2160, 'preview')).toMatchObject({ cellSize: 6, columns: 320, rows: 180 });
    expect(particleBudgetNotes(fine, 3840, 2160)).toEqual([
      'cellSize: 2 px cells (pixels of a 1080p frame) need 518,400 particles; the preview draws 6 px cells (budget 60,000), the export 4 px cells (budget 180,000).']);
    expect(getEffect('pixel-particle-disintegrate')).toHaveProperty('paramWarnings');
  });

  it('keeps the output-pixel grid of effects saved before, and says it follows the render size', () => {
    const saved = { ...defaults(), cellReference: 'output' };
    expect(particleGrid(saved, 3840, 2160, 'preview')).toMatchObject({ cellSize: 12, cellPixels: 12, columns: 320, rows: 180, clampedByBudget: true });
    expect(particleGrid(saved, 960, 540, 'preview')).toMatchObject({ cellSize: 8, columns: 120, rows: 68 });
    const notes = particleBudgetNotes(saved, 3840, 2160);
    expect(notes[0]).toBe('cellSize: at 3840 x 2160, 8 px cells need 129,600 particles; the preview draws 12 px cells (budget 60,000), the export 8 px cells.');
    expect(notes[1]).toMatch(/^cellSize: this effect was saved when Cell Size counted output pixels/);
    const { cellReference: _unit, ...old } = defaults();
    const effect = { id: 'dust', type: 'pixel-particle-disintegrate', name: 'Dust', enabled: true, params: old } as Effect;
    expect(migratePersistedEffectOperatorGraph(effect).params.cellReference).toBe('output');
    expect(migratePersistedEffectOperatorGraph({ ...effect, params: defaults() }).params.cellReference).toBe('1080p');
  });

  it('reports clamped Cell Size and Progress values', () => {
    expect(particleBudgetNotes({ ...defaults(), cellSize: 0.5, progress: 1.4 })).toEqual(expect.arrayContaining([
      'cellSize: 0.5 is outside 1-256 px; it is clamped to 1.', 'progress: 1.4 is outside 0-1; it is clamped to 1.']));
    expect(particleBudgetNotes({ ...defaults(), cellSize: 300 })).toEqual(['cellSize: 300 is outside 1-256 px; it is clamped to 256.']);
  });
});

describe('Pixel Particle Disintegrate Fade', () => {
  it('reads Fade through the render node, also from graphs saved before it existed', () => {
    expect(defaults().fade).toBe(0.7);
    expect(compileParticleDisintegrateGraph(undefined, { ...defaults(), fade: 0.4 }).params.fade).toBe(0.4);
    const saved = createDefaultParticleDisintegrateGraph();
    const render = saved.nodes.find(node => node.operator === 'render.pixel-particles')!;
    delete render.bindings.fade;
    expect(compileParticleDisintegrateGraph(saved, { ...defaults(), fade: 0.25 }).params.fade).toBe(0.25);
  });

  it('keeps saved effects and custom Looks without Fade opaque over the flight (Fade 0)', () => {
    const { fade: _fade, ...saved } = defaults();
    const effect = { id: 'dust', type: 'pixel-particle-disintegrate', name: 'Dust', enabled: true, params: saved } as Effect;
    expect(migratePersistedEffectOperatorGraph(effect).params.fade).toBe(0);
    expect(migratePersistedEffectOperatorGraph({ ...effect, params: { ...saved, fade: 0.5 } }).params.fade).toBe(0.5);
    expect(withLegacyLookParams('pixel-particle-disintegrate', { progress: 0.3 })).toEqual({ progress: 0.3, fade: 0, cellReference: 'output' });
    expect(withLegacyLookParams('pixel-particle-disintegrate', { progress: 0.3, fade: 0.9, cellReference: '1080p' })).toEqual({ progress: 0.3, fade: 0.9, cellReference: '1080p' });
  });
});

describe('Pixel Particle Disintegrate release timing', () => {
  const defaults = { seed: 1, gustStrength: 0.75, gustScale: 5.5, windSweep: 0.35, releaseContrast: 0.65, stagger: 0.35, directionX: 0, directionY: -0.25 };

  it('measures the spread of the raw delays, so the shader can lay the releases out evenly', () => {
    const quantiles = releaseQuantiles(defaults, 240, 135);
    expect(quantiles).toHaveLength(RELEASE_QUANTILE_COUNT + 1);
    for (let index = 1; index < quantiles.length; index += 1) expect(quantiles[index]).toBeGreaterThanOrEqual(quantiles[index - 1]);
    // The raw delays bunch up: half of the cells sit in less than a third of their range...
    const range = quantiles[32] - quantiles[0];
    expect(quantiles[24] - quantiles[8]).toBeLessThan(range / 3);
    // ...and the window the ranks are laid out over spans Progress 0 to about 0.84.
    expect(releaseWindow(quantiles)).toBeCloseTo(Math.min(range * RELEASE_SPREAD, 0.9), 6);
    expect(releaseWindow(quantiles)).toBeGreaterThan(0.75);
    expect(releaseWindow(quantiles)).toBeLessThan(0.9);
    // The sample is the grid's own cells: the quantiles are the sorted raw delays at 32 even steps.
    const small = releaseQuantiles(defaults, 9, 5), delays: number[] = [];
    for (let row = 0; row < 5; row += 1) for (let column = 0; column < 9; column += 1) delays.push(rawReleaseDelay(defaults, column, row, 9, 5));
    const sorted = delays.toSorted((a, b) => a - b);
    expect(small[0]).toBeCloseTo(sorted[0], 6);
    expect(small[32]).toBeCloseTo(sorted[44], 6);
    expect(small[16]).toBeCloseTo(sorted[22], 6);
  });

  it('keeps everything letting go at once without Stagger and Wind Sweep', () => {
    expect(releaseWindow(releaseQuantiles({ ...defaults, stagger: 0, windSweep: 0 }, 240, 135))).toBe(0);
    // Wide Stagger and full Wind Sweep stop at the largest window, so flights still end by Progress 1.
    expect(releaseWindow(releaseQuantiles({ ...defaults, stagger: 0.95, windSweep: 1 }, 240, 135))).toBe(0.9);
  });
});
