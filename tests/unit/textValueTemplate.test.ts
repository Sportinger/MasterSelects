import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';
import { installCanvas2DMock } from '../helpers/mockCanvas2d';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import { formatTextValueTemplate, hasTextValueTokens } from '../../src/services/text/textValueTemplate';
import { renderTextFrame } from '../../src/services/text/textFrameRuntime';
import { textRenderer } from '../../src/services/textRenderer';
import type { TextClipProperties } from '../../src/types/text';

beforeEach(() => installCanvas2DMock());
afterEach(() => vi.restoreAllMocks());

const makeText = (text: string, extra: Partial<TextClipProperties> = {}) => createMockClip({
  id: 'txt', trackId: 'video-1', startTime: 10, duration: 5,
  source: { type: 'text', textCanvas: document.createElement('canvas') },
  textProperties: { ...DEFAULT_TEXT_PROPERTIES, boxEnabled: false, text, ...extra },
});
const renderedText = (spy: ReturnType<typeof vi.spyOn>) => (spy.mock.calls.at(-1)?.[0] as TextClipProperties).text;

describe('text value tokens', () => {
  it('formats value and time tokens and keeps unknown braces literal', () => {
    expect(hasTextValueTokens('{value}×')).toBe(true);
    expect(hasTextValueTokens('{name}')).toBe(false);
    expect(formatTextValueTemplate('{value}×', { value: 6.8324, time: 0 })).toBe('6.83×');
    expect(formatTextValueTemplate('{value}×', { value: 1, time: 0 })).toBe('1×');
    expect(formatTextValueTemplate('{value:2}×', { value: 1, time: 0 })).toBe('1.00×');
    expect(formatTextValueTemplate('{value*100:0}%', { value: 6.8324, time: 0 })).toBe('683%');
    expect(formatTextValueTemplate('{value:1}', { value: -0.01, time: 0 })).toBe('0.0');
    expect(formatTextValueTemplate('t={time:1}s {name}', { value: 0, time: 2.25 })).toBe('t=2.3s {name}');
  });

  it('animates text.value keyframes per frame', () => {
    const spy = vi.spyOn(textRenderer, 'render');
    const keys = [createMockKeyframe({ clipId: 'txt', property: 'text.value', time: 0, value: 1 }),
      createMockKeyframe({ clipId: 'txt', property: 'text.value', time: 2, value: 7 })];
    const clip = makeText('{value:1}×');
    renderTextFrame(clip, keys, 1);
    expect(renderedText(spy)).toBe('4.0×');
    renderTextFrame(clip, keys, 2);
    expect(renderedText(spy)).toBe('7.0×');
  });

  it('reuses the runtime raster while the formatted string is unchanged', () => {
    const clip = makeText('{time:0}s');
    const spy = vi.spyOn(textRenderer, 'render');
    const a = renderTextFrame(clip, [], 0.1);
    expect(a).not.toBe(clip.source?.textCanvas);
    expect(renderTextFrame(clip, [], 0.2)).toBe(a);
    expect(spy).toHaveBeenCalledTimes(1);
    renderTextFrame(clip, [], 1.2);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(renderedText(spy)).toBe('1s');
  });

  it('follows another clip’s speed at the same timeline time', () => {
    const video = createMockClip({ id: 'vid', trackId: 'video-2', startTime: 8, duration: 10, speed: 1 });
    const clip = makeText('{value:2}×', { valueLink: { clipId: 'vid', property: 'speed' } });
    useTimelineStore.setState({ clips: [video, clip], clipKeyframes: new Map([['vid', [
      createMockKeyframe({ clipId: 'vid', property: 'speed', time: 2, value: 1 }),
      createMockKeyframe({ clipId: 'vid', property: 'speed', time: 6, value: 6.83 }),
    ]]]) });
    const spy = vi.spyOn(textRenderer, 'render');
    renderTextFrame(clip, [], 0); // timeline 10 = video local 2
    expect(renderedText(spy)).toBe('1.00×');
    renderTextFrame(clip, [], 4); // timeline 14 = video local 6
    expect(renderedText(spy)).toBe('6.83×');
  });
});
