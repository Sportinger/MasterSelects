export interface GaussianSplatRenderDebugSnapshot {
  clipId: string;
  sceneSplatCount: number;
  activeSplatCount: number;
  effectiveSplatCount: number;
  drawCount: number;
  viewport: { width: number; height: number };
  backgroundColor?: string;
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
      hasParticleOverride: frame.hasParticleOverride,
      usedCull: frame.usedCull,
      usedSort: frame.usedSort,
    });
    loggedClips.add(frame.clipId);
  }

  snapshots.set(frame.clipId, {
    clipId: frame.clipId,
    sceneSplatCount: frame.sceneSplatCount,
    activeSplatCount: frame.activeSplatCount,
    effectiveSplatCount: frame.effectiveSplatCount,
    drawCount: frame.drawCount,
    viewport: frame.viewport,
    backgroundColor: frame.backgroundColor,
    usedCull: frame.usedCull,
    usedSort: frame.usedSort,
  });
}
