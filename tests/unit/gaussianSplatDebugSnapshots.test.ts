import { describe, expect, it, vi } from 'vitest';
import { recordSplatRenderDebug, type SplatRenderDebugFrame } from '../../src/engine/gaussian/core/splatRenderer/debugSnapshots';

function makeFrame(overrides: Partial<SplatRenderDebugFrame> = {}): SplatRenderDebugFrame {
  return {
    clipId: 'splat-clip',
    sceneSplatCount: 100,
    activeSplatCount: 100,
    effectiveSplatCount: 80,
    drawCount: 60,
    viewport: { width: 1920, height: 1080 },
    splatScale: 1.5,
    nearPlane: 0.5,
    farPlane: 500,
    sortFrequency: 7,
    cameraNear: 0.1,
    cameraFar: 1000,
    colorWrite: true,
    hasParticleOverride: false,
    usedCull: true,
    usedSort: true,
    ...overrides,
  };
}

describe('recordSplatRenderDebug', () => {
  it('keeps the visible color pass settings when a depth-mask pass follows it', () => {
    const snapshots = new Map();
    const loggedClips = new Set<string>();
    const log = { info: vi.fn() };

    recordSplatRenderDebug(log, loggedClips, snapshots, makeFrame());
    recordSplatRenderDebug(log, loggedClips, snapshots, makeFrame({
      colorWrite: false,
      sortFrequency: 0,
      usedSort: false,
    }));

    expect(snapshots.get('splat-clip')).toMatchObject({
      splatScale: 1.5,
      nearPlane: 0.5,
      farPlane: 500,
      sortFrequency: 7,
      usedSort: true,
    });
  });
});
