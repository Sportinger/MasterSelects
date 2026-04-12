// Temporal 4D frame sampler — deterministic, stateless, pure function.
// Given clip-local time and sequence metadata, returns frame indices for blending.

export interface TemporalSampleResult {
  /** Primary frame index (0-based) */
  frameA: number;
  /** Secondary frame index for blending (same as frameA when nearest-frame) */
  frameB: number;
  /** Interpolation weight: 0.0 = use frameA only, 1.0 = use frameB only */
  blendAlpha: number;
}

/**
 * Deterministic temporal sampling -- pure function, no state.
 * Given clip-local time and sequence metadata, returns frame indices
 * and blend weight for 4D gaussian splat playback.
 *
 * Determinism guarantee: identical inputs always produce identical outputs.
 * No Math.random(), no accumulated state.
 */
export function sampleTemporalFrame(
  clipLocalTime: number,
  sequenceFps: number,
  frameCount: number,
  settings: {
    playbackMode: 'loop' | 'clamp' | 'pingpong';
    frameBlend: number; // 0 = nearest, 1 = full linear blend
  },
): TemporalSampleResult {
  // Edge case: single frame or invalid
  if (frameCount <= 1 || sequenceFps <= 0) {
    return { frameA: 0, frameB: 0, blendAlpha: 0 };
  }

  // Continuous frame position from time
  const continuousFrame = clipLocalTime * sequenceFps;

  let frame: number;

  switch (settings.playbackMode) {
    case 'loop':
      // Modular wrap (handles negative times)
      frame = ((continuousFrame % frameCount) + frameCount) % frameCount;
      break;

    case 'clamp':
      frame = Math.max(0, Math.min(frameCount - 1, continuousFrame));
      break;

    case 'pingpong': {
      // Period = 2 * (frameCount - 1) for smooth back-and-forth
      const period = (frameCount - 1) * 2;
      if (period <= 0) {
        frame = 0;
        break;
      }
      const t = ((continuousFrame % period) + period) % period;
      frame = t < frameCount ? t : period - t;
      break;
    }
  }

  const frameA = Math.floor(frame);
  const clampedA = Math.max(0, Math.min(frameCount - 1, frameA));

  // For blending, frameB is the next frame (clamped to valid range)
  const clampedB = Math.min(clampedA + 1, frameCount - 1);

  // Raw interpolation factor is the fractional part
  const rawAlpha = frame - frameA;

  // Scale by frameBlend setting: 0 = no blending (nearest frame), 1 = full linear
  const blendAlpha = settings.frameBlend > 0 ? rawAlpha * settings.frameBlend : 0;

  return {
    frameA: clampedA,
    frameB: clampedB,
    blendAlpha,
  };
}
