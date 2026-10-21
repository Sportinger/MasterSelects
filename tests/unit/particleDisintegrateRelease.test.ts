import { describe, expect, it } from 'vitest';
import { getDefaultParams, getEffect } from '../../src/effects';
import { particleBudgetNotes, particleGrid } from '../../src/effects/stylize/pixel-particle-disintegrate/budget';
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
