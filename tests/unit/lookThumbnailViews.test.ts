import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { lookPreviewEffects } from '../../src/effects/looks/lookEntryGraph';
import type { LookDefinition } from '../../src/effects/looks/types';
import {
  chooseLookThumbnailView, compareLookView, downscaleLookRaster, isAnimatedLook, lookDetailRegionInFrame,
  lookThumbnailStillTimes, lookThumbnailViewRect, lookThumbnailWorkSize, LOOK_THUMBNAIL_RETRY_TIMES, type LookRaster,
} from '../../src/effects/looks/lookThumbnailViews';
import { fitThumbnailToWidthRect } from '../../src/effects/looks/lookThumbnailGeometry';
import { scanlinePeriodPx, SCANLINES_FADE_END_PX, SCANLINES_FADE_START_PX } from '../../src/effects/stylize/scanlines/scanlinesModel';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { applyWorkerSoftwareImageGraphs } from '../../src/services/render/workerSoftwareImageGraphs';

/** The tile the + Add Effect browser builds for an effect (EffectCatalogPicker). */
const effectTile = (effectId: string): LookDefinition => ({
  id: `effect-preview-${effectId}`, name: effectId, category: 'digital', thumbnail: { kind: 'generated' },
  stack: [{ effectId, params: getDefaultParams(effectId), enabled: true }], tags: [], builtIn: true,
});

const hash = (x: number, y: number) => { const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return value - Math.floor(value); };

/** A frame with gradients, a checker, a disc and fine noise (frame-relative, so any size shows the same picture). */
function sourceFrame(width: number, height: number): LookRaster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, offset = (y * width + x) * 4;
    const disc = (u - 0.4) ** 2 * 3 + (v - 0.5) ** 2 < 0.04 ? 1 : 0, checker = (Math.floor(u * 24) + Math.floor(v * 14)) % 2;
    const noise = (hash(Math.floor(u * 200), Math.floor(v * 112)) - 0.5) * 30;
    data.set([50 + 140 * u + 30 * checker + noise, 70 + 110 * v + 50 * disc + noise, 130 - 60 * u + 70 * disc + 20 * checker + noise, 255], offset);
  }
  return { data, width, height };
}

/** The effect tile's stack through the software image-graph renderer (the GPU recipe, on the CPU). */
function renderTile(effectId: string, source: LookRaster, time = 0): LookRaster {
  const [effect] = lookPreviewEffects(effectTile(effectId));
  const { plan } = prepareImageEffect(effect);
  const data = source.data.slice();
  applyWorkerSoftwareImageGraphs(data, source.width, source.height, [plan!], time);
  return { data, width: source.width, height: source.height };
}

/** What lookThumbnailRuntime.renderLook decides for a still rendered at the source's (working) size. */
function chooseFor(source: LookRaster, rendered: LookRaster) {
  const tile = fitThumbnailToWidthRect(source.width, source.height, 256, 144);
  const view = (raster: LookRaster, rect: NonNullable<ReturnType<typeof lookThumbnailViewRect>>) =>
    downscaleLookRaster(raster, rect, tile.width, tile.height, true);
  const frameRect = lookThumbnailViewRect('frame', source, tile)!, detailRect = lookThumbnailViewRect('detail', source, tile);
  const frame = view(rendered, frameRect), sourceFrameView = view(source, frameRect);
  const centre = lookDetailRegionInFrame(source, tile);
  const detail = detailRect ? compareLookView(view(rendered, detailRect), view(source, detailRect), tile.width, tile.height) : null;
  return {
    choice: chooseLookThumbnailView({ frame: compareLookView(frame, sourceFrameView, tile.width, tile.height),
      frameCentre: centre ? compareLookView(frame, sourceFrameView, tile.width, tile.height, centre) : null, detail }),
    detail,
  };
}

describe('look thumbnail views: why Scanlines, CRT Screen and Analog Signal Lab tiles showed the source', () => {
  it('at the 256x144 tile the default Scanlines are too dense to draw and fade out; at the working size they show', () => {
    // The cause: effects ran at tile size, where frame-relative lines fall below their anti-aliasing floor.
    expect(scanlinePeriodPx(getDefaultParams('scanlines').density as number, 144)).toBeLessThan(SCANLINES_FADE_START_PX);
    const work = lookThumbnailWorkSize(1920, 1080);
    expect(work).toEqual({ width: 1280, height: 720 });
    expect(scanlinePeriodPx(getDefaultParams('scanlines').density as number, work.height)).toBeGreaterThan(SCANLINES_FADE_END_PX);
  });

  it('shows the Scanlines tile as an enlarged detail, where the lines are visible', () => {
    const source = sourceFrame(640, 360);
    const { choice, detail } = chooseFor(source, renderTile('scanlines', source));
    expect(choice).toBe('detail');
    expect(detail!.structureChange).toBeGreaterThan(5);
  });

  it('keeps whole-frame effects on the frame view and says when an effect changes nothing', () => {
    const source = sourceFrame(640, 360);
    expect(chooseFor(source, renderTile('invert', source)).choice).toBe('frame');
    expect(chooseFor(source, renderTile('vignette', source)).choice).toBe('frame');
    // Brightness 0 is the identity: the tile must say so instead of silently showing the source.
    expect(chooseFor(source, renderTile('brightness', source)).choice).toBe('unchanged');
  });

  it('tries later still times for an animated effect that is between bursts at the start time', () => {
    const source = sourceFrame(256, 144);
    expect(isAnimatedLook(effectTile('glitch'))).toBe(true);
    expect(isAnimatedLook(effectTile('invert'))).toBe(false);
    // At Speed 1 Glitch changes state 12 times a second: state 1 (0.125 s) is clean, state 7 (0.625 s) a burst.
    const start = 0.125, [first, second] = lookThumbnailStillTimes(start, true);
    expect(chooseFor(source, renderTile('glitch', source, first)).choice).toBe('unchanged');
    expect(chooseFor(source, renderTile('glitch', source, second)).choice).toBe('frame');
    expect(lookThumbnailStillTimes(start, true)).toEqual([start, ...LOOK_THUMBNAIL_RETRY_TIMES.map(offset => start + offset)]);
    expect(lookThumbnailStillTimes(start, false)).toEqual([start]);
  }, 30_000);
});

describe('look thumbnail views: resampling', () => {
  it('composites cut-outs over black instead of showing their hidden colour (CRT tube corners, keys)', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let offset = 0; offset < data.length; offset += 4) data.set([255, 200, 100, offset < 32 ? 0 : 255], offset);
    const tile = downscaleLookRaster({ data, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }, 4, 4, true);
    expect(Array.from(tile.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(tile.subarray(32, 36))).toEqual([255, 200, 100, 255]);
    // Straight alpha keeps the colour and averages coverage.
    const straight = downscaleLookRaster({ data, width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }, 1, 1, false);
    expect(Array.from(straight)).toEqual([255, 200, 100, 128]);
  });

  it('averages lines finer than the tile to an even tone instead of moiré, and copies the 1:1 detail', () => {
    const width = 1280, height = 720, data = new Uint8ClampedArray(width * height * 4);
    // Lines 1.8 tile pixels apart once reduced 5x: above the tile's Nyquist limit.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const level = 128 + 100 * Math.sin(2 * Math.PI * y / 9);
      data.set([level, level, level, 255], (y * width + x) * 4);
    }
    const raster = { data, width, height }, tile = { width: 256, height: 144 };
    const frame = downscaleLookRaster(raster, lookThumbnailViewRect('frame', raster, tile)!, 256, 144, true);
    const column = Array.from({ length: 140 }, (_, y) => frame[((y + 2) * 256 + 128) * 4]);
    expect(Math.max(...column) - Math.min(...column)).toBeLessThan(40);
    const detailRect = lookThumbnailViewRect('detail', raster, tile)!;
    expect(detailRect).toEqual({ x: 512, y: 288, width: 256, height: 144 });
    const detail = downscaleLookRaster(raster, detailRect, 256, 144, true);
    expect(detail[0]).toBe(data[(288 * width + 512) * 4]);
  });

  it('sizes the working frame to the output, capped, and offers a detail only with resolution to spare', () => {
    expect(lookThumbnailWorkSize(3840, 2160)).toEqual({ width: 1280, height: 720 });
    expect(lookThumbnailWorkSize(1080, 1920)).toEqual({ width: 720, height: 1280 });
    expect(lookThumbnailWorkSize(640, 360)).toEqual({ width: 640, height: 360 });
    expect(lookThumbnailViewRect('detail', { width: 400, height: 225 }, { width: 256, height: 144 })).toBeNull();
    expect(lookDetailRegionInFrame({ width: 1280, height: 720 }, { width: 256, height: 144 })).toEqual({ x: 102, y: 57, width: 52, height: 30 });
  });
});
