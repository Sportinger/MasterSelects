export interface GaussianSplatRenderDebugSnapshot {
  clipId: string;
  sceneSplatCount: number;
  activeSplatCount: number;
  effectiveSplatCount: number;
  drawCount: number;
  viewport: { width: number; height: number };
  backgroundColor?: string;
  splatScale: number;
  nearPlane: number;
  farPlane: number;
  sortFrequency: number;
  cameraNear: number;
  cameraFar: number;
  usedCull: boolean;
  usedSort: boolean;
}

interface RenderDebugLogger {
  info(message: string, data?: unknown): void;
}

export interface SplatRenderDebugFrame {
  clipId: string;
  sceneSplatCount: number;
  activeSplatCount: number;
  effectiveSplatCount: number;
  drawCount: number;
  viewport: { width: number; height: number };
  backgroundColor?: string;
  splatScale: number;
  nearPlane: number;
  farPlane: number;
  sortFrequency: number;
  cameraNear: number;
  cameraFar: number;
  colorWrite: boolean;
  hasParticleOverride: boolean;
  usedCull: boolean;
  usedSort: boolean;
}

export function recordSplatRenderDebug(
  log: RenderDebugLogger,
  loggedClips: Set<string>,
  snapshots: Map<string, GaussianSplatRenderDebugSnapshot>,
  frame: SplatRenderDebugFrame,
): void {
  if (!loggedClips.has(frame.clipId)) {
    log.info('Gaussian debug render', {
      clipId: frame.clipId,
      sceneSplatCount: frame.sceneSplatCount,
      activeSplatCount: frame.activeSplatCount,
      effectiveSplatCount: frame.effectiveSplatCount,
      drawCount: frame.drawCount,
      viewport: frame.viewport,
      splatScale: frame.splatScale,
      nearPlane: frame.nearPlane,
      farPlane: frame.farPlane,
      sortFrequency: frame.sortFrequency,
      cameraNear: frame.cameraNear,
      cameraFar: frame.cameraFar,
      colorWrite: frame.colorWrite,
      hasParticleOverride: frame.hasParticleOverride,
      usedCull: frame.usedCull,
      usedSort: frame.usedSort,
    });
    loggedClips.add(frame.clipId);
  }

  // Native shared-scene rendering follows the visible color pass with a
  // depth-mask-only pass. Keep the visible pass as the public snapshot so
  // its quality/sort settings are not overwritten by the mask's fixed ones.
  if (!frame.colorWrite && snapshots.has(frame.clipId)) return;

  snapshots.set(frame.clipId, {
    clipId: frame.clipId,
    sceneSplatCount: frame.sceneSplatCount,
    activeSplatCount: frame.activeSplatCount,
    effectiveSplatCount: frame.effectiveSplatCount,
    drawCount: frame.drawCount,
    viewport: frame.viewport,
    backgroundColor: frame.backgroundColor,
    splatScale: frame.splatScale,
    nearPlane: frame.nearPlane,
    farPlane: frame.farPlane,
    sortFrequency: frame.sortFrequency,
    cameraNear: frame.cameraNear,
    cameraFar: frame.cameraFar,
    usedCull: frame.usedCull,
    usedSort: frame.usedSort,
  });
}
