import { describe, expect, it } from 'vitest';
import { fitThumbnailToWidthRect } from '../../src/effects/looks/lookThumbnailGeometry';

describe('fitThumbnailToWidthRect', () => {
  it('fills the tile width and crops a portrait composition vertically', () => {
    expect(fitThumbnailToWidthRect(1080, 1920, 256, 144)).toEqual({
      width: 256,
      height: 455,
      x: 0,
      y: -156,
    });
  });

  it('letterboxes a wide composition inside the tile', () => {
    expect(fitThumbnailToWidthRect(2560, 1080, 256, 144)).toEqual({
      width: 256,
      height: 108,
      x: 0,
      y: 18,
    });
  });

  it('uses the entire tile when the aspect ratios match', () => {
    expect(fitThumbnailToWidthRect(1920, 1080, 256, 144)).toEqual({
      width: 256,
      height: 144,
      x: 0,
      y: 0,
    });
  });
});
