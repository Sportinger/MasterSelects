import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engine } from '../../src/engine/WebGPUEngine';
import { googleFontsService } from '../../src/services/googleFontsService';
import { textRenderer } from '../../src/services/textRenderer';
import { layerBuilder } from '../../src/services/layerBuilder';
import { isTextFontReady, redrawTextWhenFontLoads } from '../../src/services/text/textFontRefresh';
import { renderTimelineTextCanvasRuntime } from '../../src/services/timeline/timelineGeneratedCanvasRuntime';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';

const fonts = vi.mocked(googleFontsService);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(engine.requestRender).mockReset();
  vi.mocked(layerBuilder.invalidateCache).mockClear();
  fonts.isFontLoaded.mockImplementation(() => true);
  fonts.isManagedFont.mockImplementation(() => false);
  fonts.loadFont.mockImplementation(() => Promise.resolve());
  useTimelineStore.setState({ tracks: DEFAULT_TRACKS, clips: [], playheadPosition: 0, isExporting: false });
});

describe('text clip preview invalidation', () => {
  it('asks the preview for a frame only after the new text clip is in the store', async () => {
    const clipsAtRequest: number[] = [];
    vi.mocked(engine.requestRender).mockImplementation(() => { clipsAtRequest.push(useTimelineStore.getState().clips.length); });
    const clipId = await useTimelineStore.getState().addTextClip('video-1', 0, 5, true);
    expect(clipId).toBeTruthy();
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId);
    expect(clip?.source?.textCanvas).toBeInstanceOf(HTMLCanvasElement);
    expect(clipsAtRequest.length).toBeGreaterThan(0);
    expect(clipsAtRequest.at(-1)).toBe(1);
  });

  it('redraws a text raster drawn before its web font loaded and requests a frame', async () => {
    let loaded = false;
    const font = deferred();
    fonts.isManagedFont.mockImplementation(family => family === 'Roboto');
    fonts.isFontLoaded.mockImplementation(() => loaded);
    fonts.loadFont.mockImplementation(() => font.promise);
    const props = { ...DEFAULT_TEXT_PROPERTIES, text: 'Undo restored title', fontFamily: 'Roboto' };

    const draw = vi.mocked(textRenderer.render);
    draw.mockClear();
    const canvas = renderTimelineTextCanvasRuntime({ textProperties: props, dimensions: { width: 320, height: 180 } });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(engine.requestRender).not.toHaveBeenCalled();

    loaded = true;
    font.resolve();
    await font.promise; await Promise.resolve();

    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenLastCalledWith(props, canvas);
    expect(layerBuilder.invalidateCache).toHaveBeenCalled();
    expect(engine.requestRender).toHaveBeenCalled();
  });

  it('treats system fonts as ready and never schedules a redraw for them', () => {
    const redraw = vi.fn();
    expect(isTextFontReady({ fontFamily: 'Arial', fontWeight: 400 })).toBe(true);
    redrawTextWhenFontLoads(document.createElement('canvas'), { fontFamily: 'Arial', fontWeight: 400 }, redraw);
    expect(fonts.loadFont).not.toHaveBeenCalled();
    expect(redraw).not.toHaveBeenCalled();
  });

  it('keeps only the newest pending redraw per canvas and reports a font that never loads', async () => {
    const first = deferred(), second = deferred();
    fonts.isManagedFont.mockImplementation(() => true);
    fonts.isFontLoaded.mockImplementation(() => false);
    fonts.loadFont.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const canvas = document.createElement('canvas');
    const stale = vi.fn(), latest = vi.fn();
    redrawTextWhenFontLoads(canvas, { fontFamily: 'Lato', fontWeight: 400 }, stale);
    redrawTextWhenFontLoads(canvas, { fontFamily: 'Lato', fontWeight: 700 }, latest);
    first.resolve(); second.resolve();
    await Promise.all([first.promise, second.promise]); await Promise.resolve();
    // The font failed to load: nothing is redrawn and no frame is requested.
    expect(stale).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    expect(engine.requestRender).not.toHaveBeenCalled();
  });
});
