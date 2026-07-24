import { describe, expect, it } from 'vitest';
import type { ClipTransform } from '../../src/types/timelineCore';
import {
  mapSourceUvToPreviewUv,
  remapPreviewMaskToSource,
  type MatAnyoneMaskGeometry,
} from '../../src/components/panels/sam2/MatAnyoneMaskPreparation';

function transform(overrides: Partial<ClipTransform> = {}): ClipTransform {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1 },
    rotation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

function geometry(overrides: Partial<MatAnyoneMaskGeometry> = {}): MatAnyoneMaskGeometry {
  return {
    sourceWidth: 1920,
    sourceHeight: 1080,
    outputWidth: 1920,
    outputHeight: 1080,
    transform: transform(),
    ...overrides,
  };
}

describe('MatAnyone source-space mask mapping', () => {
  it('keeps identity source UVs in the same preview position', () => {
    expect(mapSourceUvToPreviewUv({ x: 0.2, y: 0.7 }, geometry())).toEqual({ x: 0.2, y: 0.7 });
  });

  it('undoes source aspect correction', () => {
    const mapped = mapSourceUvToPreviewUv({ x: 0, y: 0.5 }, geometry({
      sourceWidth: 1440,
      sourceHeight: 1080,
    }));
    expect(mapped?.x).toBeCloseTo(0.125);
    expect(mapped?.y).toBeCloseTo(0.5);
  });

  it('maps position, scale, and z rotation back into preview space', () => {
    const mapped = mapSourceUvToPreviewUv({ x: 0.5, y: 0.5 }, geometry({
      transform: transform({
        position: { x: 0.1, y: 0, z: 0 },
        scale: { x: 2, y: 2 },
        rotation: { x: 0, y: 0, z: 90 },
      }),
    }));
    expect(mapped?.x).toBeCloseTo(0.5);
    expect(mapped?.y).toBeCloseTo(0.144444);
  });

  it('returns null for raw pixels outside a source crop', () => {
    const cropped = geometry({ sourceRect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } });
    expect(mapSourceUvToPreviewUv({ x: 0.1, y: 0.5 }, cropped)).toBeNull();
    expect(mapSourceUvToPreviewUv({ x: 0.5, y: 0.5 }, cropped)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('inverts finite 3D compositor rotations and perspective', () => {
    const mapped = mapSourceUvToPreviewUv({ x: 0.5, y: 0.5 }, geometry({
      transform: transform({
        position: { x: 0, y: 0, z: 0.2 },
        rotation: { x: 20, y: -15, z: 0 },
      }),
    }));
    expect(mapped?.x).toBeTypeOf('number');
    expect(mapped?.y).toBeTypeOf('number');
    expect(Number.isFinite(mapped!.x)).toBe(true);
    expect(Number.isFinite(mapped!.y)).toBe(true);
  });

  it('creates a binary source raster from the preview mask', () => {
    const image = remapPreviewMaskToSource({
      width: 2,
      height: 2,
      values: new Uint8Array([255, 0, 0, 255]),
    }, geometry({ sourceWidth: 2, sourceHeight: 2, outputWidth: 2, outputHeight: 2 }));
    expect(Array.from(image.data.filter((_, index) => index % 4 === 0))).toEqual([255, 0, 0, 255]);
  });
});
