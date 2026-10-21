/**
 * Particle grid of Pixel Particle Disintegrate: one particle per Cell Size x Cell Size cell,
 * limited by the particle budget of the render quality (preview or export) and the hard limit.
 *
 * Cell Size counts pixels of a 1080p frame (shorter side), like Pixelate and Acuarela: the grid is
 * cut on the frame scaled to 1080 px, so a half-quality preview, a 4K export and a thumbnail all
 * cut the same cells. Effects saved before that carry `cellReference: 'output'` (set by the load
 * migration) and keep counting output pixels, so their grid depends on the render size.
 * Over budget, the cells grow until the grid fits, so a preview and its export can differ in
 * cell size; `particleBudgetNotes` says so instead of clamping silently.
 */
export type ParticleCellUnit = '1080p' | 'output';

export interface ParticleGrid {
  /** Cell size in `unit` pixels after the budget. */
  readonly cellSize: number;
  readonly requestedCellSize: number;
  readonly unit: ParticleCellUnit;
  /** Cell size in pixels of the frame being rendered. */
  readonly cellPixels: number;
  readonly columns: number;
  readonly rows: number;
  readonly budget: number;
  /** Particles the requested Cell Size would need. */
  readonly requestedParticles: number;
  readonly clampedByBudget: boolean;
}

type Params = Record<string, unknown>;
const REFERENCE_HEIGHT = 1080;
const finite = (params: Params, name: string, fallback: number) => {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function particleCellUnit(params: Params): ParticleCellUnit {
  return params.cellReference === 'output' ? 'output' : '1080p';
}

export function particleGrid(params: Params, width: number, height: number, quality: 'preview' | 'export'): ParticleGrid {
  const unit = particleCellUnit(params);
  const requestedCellSize = clamp(finite(params, 'cellSize', 8), 1, 256);
  const preview = Math.floor(clamp(finite(params, 'maxPreviewParticles', 60000), 1, 1_000_000));
  const exported = Math.floor(clamp(finite(params, 'maxExportParticles', 180000), 1, 1_000_000));
  const hard = Math.floor(clamp(finite(params, 'maxInstances', 220000), 1, 1_000_000));
  const budget = Math.max(1, Math.min(quality === 'export' ? exported : preview, hard));
  const w = Math.max(1, width), h = Math.max(1, height);
  // The frame in cell units: output pixels, or the frame scaled so its shorter side is 1080.
  const short = Math.min(w, h);
  const gw = unit === 'output' ? w : w * REFERENCE_HEIGHT / short, gh = unit === 'output' ? h : h * REFERENCE_HEIGHT / short;
  const initial = Math.ceil(gw / requestedCellSize) * Math.ceil(gh / requestedCellSize);
  const clampedByBudget = initial > budget;
  let cellSize = clampedByBudget ? Math.ceil(requestedCellSize * Math.sqrt(initial / budget)) : requestedCellSize;
  // Rounded cell grids can still overshoot by a row or column: grow until the grid fits.
  while (Math.ceil(gw / cellSize) * Math.ceil(gh / cellSize) > budget) cellSize += 1;
  const cellPixels = unit === 'output' ? cellSize : cellSize * short / REFERENCE_HEIGHT;
  return { cellSize, requestedCellSize, unit, cellPixels, columns: Math.ceil(gw / cellSize), rows: Math.ceil(gh / cellSize), budget,
    requestedParticles: initial, clampedByBudget };
}

/** Inspector and tool notes for the composition size: budget-enlarged cells, legacy units and clamped values. */
export function particleBudgetNotes(params: Params, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const preview = particleGrid(params, width, height, 'preview'), exported = particleGrid(params, width, height, 'export');
  if (preview.clampedByBudget || exported.clampedByBudget) {
    const count = (value: number) => value.toLocaleString('en-US');
    const where = (grid: ParticleGrid) => `${grid.cellSize} px cells${grid.clampedByBudget ? ` (budget ${count(grid.budget)})` : ''}`;
    const need = preview.unit === '1080p'
      ? `${preview.requestedCellSize} px cells (pixels of a 1080p frame) need ${count(preview.requestedParticles)} particles`
      : `at ${width} x ${height}, ${preview.requestedCellSize} px cells need ${count(preview.requestedParticles)} particles`;
    notes.push(`cellSize: ${need}; the preview draws ${where(preview)}, the export ${where(exported)}.`);
  }
  if (preview.unit === 'output') {
    notes.push('cellSize: this effect was saved when Cell Size counted output pixels; it keeps that grid, so a preview below Full quality '
      + 'and exports at other sizes cut a different number of cells. Add the effect again for cells that follow the frame size.');
  }
  const cell = params.cellSize;
  if (typeof cell === 'number' && Number.isFinite(cell) && (cell < 1 || cell > 256)) notes.push(`cellSize: ${cell} is outside 1-256 px; it is clamped to ${cell < 1 ? 1 : 256}.`);
  const progress = params.progress;
  if (typeof progress === 'number' && Number.isFinite(progress) && (progress < 0 || progress > 1)) {
    notes.push(`progress: ${progress} is outside 0-1; it is clamped to ${progress < 0 ? 0 : 1}.`);
  }
  return notes;
}
