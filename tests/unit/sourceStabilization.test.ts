import { describe, expect, it } from 'vitest';
import type { PlanarTrack, SurfaceQuad } from '../../src/types/planarTracking';
import { sourceStabilization, type SourceStabilizationSettings } from '../../src/services/planarTracking/sourceStabilization';
import { projectPoint } from '../../src/services/planarTracking/surfaceGeometry';

const reference: SurfaceQuad = [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.6 }, { x: 0.2, y: 0.6 }];
// A quarter turn, 2x scale and translation in a 2:1 image.
const moved = reference.map(p => ({ x: 0.7 - (p.y - 0.4), y: 0.5 + 4 * (p.x - 0.3) })) as SurfaceQuad;
const track: PlanarTrack = { id: 'track', name: 'Track', sourceId: 'source', fps: 25, referenceTime: 0,
  referenceQuad: reference, samples: [{ time: 0, duration: 0.04, quad: reference, confidence: 1 },
    { time: 1, duration: 0.08, quad: moved, confidence: 1 }], occlusions: [], enabled: true,
  color: '#fff', opacity: 1, fill: 0, lineWidth: 1, inset: 0, shape: 'outline', visibleFrom: 0, visibleTo: 2, fade: 0 };
const settings: SourceStabilizationSettings = { referenceTime: 0, strength: 1, position: true, rotation: true, scale: true };

describe('Source-time stabilization', () => {
  it('aligns each source frame to the reference in non-square source pixels', () => {
    for (const sample of track.samples) {
      const result = sourceStabilization(track, sample.time, settings, 1920, 960);
      expect(result.valid).toBe(true);
      if (!result.valid) throw new Error(result.reason);
      for (let i = 0; i < 4; i++) {
        const output = projectPoint(result.sourceToOutput, sample.quad[i]);
        expect(output.x).toBeCloseTo(reference[i].x);
        expect(output.y).toBeCloseTo(reference[i].y);
        const source = projectPoint(result.outputToSource, reference[i]);
        expect(source.x).toBeCloseTo(sample.quad[i].x);
        expect(source.y).toBeCloseTo(sample.quad[i].y);
      }
    }
  });

  it('reports gaps instead of interpolating or holding an untracked pose', () => {
    expect(sourceStabilization(track, 0.5, settings, 2, 1)).toEqual({ valid: false, reason: 'sample-gap' });
    expect(sourceStabilization(track, 1.08, settings, 2, 1)).toEqual({ valid: false, reason: 'sample-gap' });
    expect(sourceStabilization(track, 1, { ...settings, referenceTime: 0.5 }, 2, 1))
      .toEqual({ valid: false, reason: 'reference-gap' });
    expect(sourceStabilization({ ...track, enabled: false }, 1, settings, 2, 1))
      .toEqual({ valid: false, reason: 'disabled-track' });
  });

  it('supports zero strength, independent axes and a changed reference', () => {
    const identity = sourceStabilization(track, 1, { ...settings, strength: 0 }, 2, 1);
    if (!identity.valid) throw new Error(identity.reason);
    expect(projectPoint(identity.sourceToOutput, moved[0])).toEqual(moved[0]);
    const result = sourceStabilization(track, 1, { ...settings, position: false }, 2, 1);
    if (!result.valid) throw new Error(result.reason);
    const center = projectPoint(result.sourceToOutput, { x: 0.7, y: 0.5 });
    expect(center.x).toBeCloseTo(0.7); expect(center.y).toBeCloseTo(0.5);
    const changed = sourceStabilization(track, 0, { ...settings, referenceTime: 1 }, 2, 1);
    if (!changed.valid) throw new Error(changed.reason);
    expect(projectPoint(changed.sourceToOutput, reference[0]).x).toBeCloseTo(moved[0].x);
    expect(projectPoint(changed.sourceToOutput, reference[0]).y).toBeCloseTo(moved[0].y);
  });
});
