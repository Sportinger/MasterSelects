/**
 * Particle grid of Pixel Particle Disintegrate: one particle per Cell Size x Cell Size pixel cell,
 * limited by the particle budget of the render quality (preview or export) and the hard limit.
 * Over budget, the cells grow until the grid fits, so a preview and its export can differ in
 * cell size at large output sizes; `particleBudgetNotes` says so instead of clamping silently.
 */
export interface ParticleGrid {
  readonly cellSize: number;
  readonly requestedCellSize: number;
  readonly columns: number;
  readonly rows: number;
  readonly budget: number;
  readonly clampedByBudget: boolean;
}

type Params = Record<string, unknown>;
const finite = (params: Params, name: string, fallback: number) => {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function particleGrid(params: Params, width: number, height: number, quality: 'preview' | 'export'): ParticleGrid {
  const requestedCellSize = clamp(finite(params, 'cellSize', 8), 1, 256);
  const preview = Math.floor(clamp(finite(params, 'maxPreviewParticles', 60000), 1, 1_000_000));
  const exported = Math.floor(clamp(finite(params, 'maxExportParticles', 180000), 1, 1_000_000));
  const hard = Math.floor(clamp(finite(params, 'maxInstances', 220000), 1, 1_000_000));
  const budget = Math.max(1, Math.min(quality === 'export' ? exported : preview, hard));
  const w = Math.max(1, width), h = Math.max(1, height);
  const initial = Math.ceil(w / requestedCellSize) * Math.ceil(h / requestedCellSize);
  const clampedByBudget = initial > budget;
  let cellSize = clampedByBudget ? Math.ceil(requestedCellSize * Math.sqrt(initial / budget)) : requestedCellSize;
  // Rounded cell grids can still overshoot by a row or column: grow until the grid fits.
  while (Math.ceil(w / cellSize) * Math.ceil(h / cellSize) > budget) cellSize += 1;
  return { cellSize, requestedCellSize, columns: Math.ceil(w / cellSize), rows: Math.ceil(h / cellSize), budget, clampedByBudget };
}

/** Inspector and tool notes for the composition size: budget-enlarged cells and clamped values. */
export function particleBudgetNotes(params: Params, width = 1920, height = 1080): string[] {
  const notes: string[] = [];
  const preview = particleGrid(params, width, height, 'preview'), exported = particleGrid(params, width, height, 'export');
  if (preview.clampedByBudget || exported.clampedByBudget) {
    const where = (grid: ParticleGrid) => grid.clampedByBudget ? `${grid.cellSize} px cells (${grid.budget.toLocaleString('en-US')} particles)` : `${grid.cellSize} px cells`;
    notes.push(`cellSize: at ${width} x ${height} the particle budget allows ${preview.requestedCellSize} px cells only up to `
      + `${Math.min(preview.budget, exported.budget).toLocaleString('en-US')} particles: the preview draws ${where(preview)}, the export ${where(exported)}.`);
  }
  const cell = params.cellSize;
  if (typeof cell === 'number' && Number.isFinite(cell) && (cell < 1 || cell > 256)) notes.push(`cellSize: ${cell} is outside 1-256 px; it is clamped to ${cell < 1 ? 1 : 256}.`);
  const progress = params.progress;
  if (typeof progress === 'number' && Number.isFinite(progress) && (progress < 0 || progress > 1)) {
    notes.push(`progress: ${progress} is outside 0-1; it is clamped to ${progress < 0 ? 0 : 1}.`);
  }
  return notes;
}
