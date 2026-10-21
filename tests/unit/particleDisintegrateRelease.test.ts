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

  it('grows the cells until the grid fits the budget, never cutting rows off', () => {
    for (const [width, height] of [[3840, 2160], [4096, 2160], [2560, 1440], [3001, 1999], [7680, 4320]]) {
      for (const quality of ['preview', 'export'] as const) {
        const grid = particleGrid(defaults(), width, height, quality);
        // Every pixel lies in a cell: the grid covers the frame, and it stays within the budget.
        expect(grid.columns * grid.cellSize).toBeGreaterThanOrEqual(width);
        expect(grid.rows * grid.cellSize).toBeGreaterThanOrEqual(height);
        expect(grid.columns * grid.rows).toBeLessThanOrEqual(grid.budget);
        // The smallest cell size that fits: one pixel less would not fit (or would be the requested size).
        const smaller = grid.cellSize - 1;
        if (grid.clampedByBudget) expect(Math.ceil(width / smaller) * Math.ceil(height / smaller)).toBeGreaterThan(grid.budget);
      }
    }
  });

  it('says when preview and export draw different cells at the composition size', () => {
    expect(particleGrid(defaults(), 3840, 2160, 'preview')).toMatchObject({ cellSize: 12, columns: 320, rows: 180, clampedByBudget: true, budget: 60000 });
    expect(particleGrid(defaults(), 3840, 2160, 'export')).toMatchObject({ cellSize: 8, clampedByBudget: false });
    expect(particleBudgetNotes(defaults(), 3840, 2160)).toEqual([
      'cellSize: at 3840 x 2160 the particle budget allows 8 px cells only up to 60,000 particles: the preview draws 12 px cells (60,000 particles), the export 8 px cells.']);
    expect(getEffect('pixel-particle-disintegrate')).toHaveProperty('paramWarnings');
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
    expect(withLegacyLookParams('pixel-particle-disintegrate', { progress: 0.3 })).toEqual({ progress: 0.3, fade: 0 });
    expect(withLegacyLookParams('pixel-particle-disintegrate', { progress: 0.3, fade: 0.9 })).toEqual({ progress: 0.3, fade: 0.9 });
  });
});
