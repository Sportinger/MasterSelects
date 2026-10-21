import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ listener: null as null | ((files: unknown[]) => void) }));
vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { subscribe: vi.fn((_selector: unknown, listener: (files: unknown[]) => void) => { hoisted.listener = listener; return () => {}; }) },
}));

import { classifyClipMediaGap, createArrivedClipMediaWatch, findCompositionsWithArrivedMedia, reportClipMediaGap } from '../../src/services/compositionRender/clipMediaGap';
import type { CompositionSources } from '../../src/services/compositionRender/sourceTypes';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { deferLinkedMedia } from '../../src/services/project/linkedMediaDemand';
import { withRepositoryHydration } from '../../src/services/project/repository/transaction/storeMutationBoundary';
import { focusStableToolbarControl } from '../../src/components/common/toolbar/toolbarFocusFallback';

const media = (id: string, extra: Partial<MediaFile> = {}) => ({ id, name: `${id}.mp4`, ...extra }) as MediaFile;
const sourcesFor = (compositionId: string): CompositionSources => ({
  compositionId, clipSources: new Map(), pendingSourceDisposers: new Map(), isReady: true, disposed: false, lastAccessTime: 0,
});

describe('composition clips whose media is not loaded yet', () => {
  afterEach(() => { deferLinkedMedia([], async () => false); document.body.innerHTML = ''; });

  it('separates a missing entry from one whose File is still loading or unavailable', () => {
    expect(classifyClipMediaGap('m1', undefined, false)).toBe('missing');
    expect(classifyClipMediaGap('m1', media('m1'), true)).toBe('loading');
    expect(withRepositoryHydration(() => classifyClipMediaGap('m1', media('m1'), false))).toBe('loading');
    deferLinkedMedia(['m1'], async () => true);
    expect(classifyClipMediaGap('m1', media('m1'), false)).toBe('loading');
    expect(classifyClipMediaGap('m2', media('m2'), false)).toBe('unavailable');
  });

  it('logs a loading clip at debug level instead of "not found", and remembers it', () => {
    const log = { debug: vi.fn(), warn: vi.fn() };
    const sources = sourcesFor('comp');
    expect(reportClipMediaGap(log, sources, 'clip1', 'm1', media('m1'), [media('m1')], true)).toBe('loading');
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug.mock.calls[0][0]).toContain('not loaded yet');
    expect(sources.pendingMediaFileIds?.get('m1')).toBe(false);

    reportClipMediaGap(log, sources, 'clip2', 'gone', undefined, [media('m1')], false);
    expect(log.warn.mock.calls[0][0]).toBe('Media file not found for clip clip2');
    expect(sources.pendingMediaFileIds?.has('gone')).toBe(false);
  });

  it('rebuilds a composition once its pending media has a File', () => {
    const cache = new Map([['comp', sourcesFor('comp')], ['other', sourcesFor('other')]]);
    cache.get('comp')!.pendingMediaFileIds = new Map([['m1', false]]);
    expect(findCompositionsWithArrivedMedia(cache, [media('m1', { url: 'blob:x' })])).toEqual([]);

    const invalidate = vi.fn();
    const watch = createArrivedClipMediaWatch(cache, invalidate);
    watch.arm(); watch.arm();
    hoisted.listener?.([media('m1', { file: new File(['x'], 'm1.mp4') })]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith('comp');
  });
});

describe('toolbar focus after the focused write-access button unmounts', () => {
  it('moves focus to the save status once it is enabled, not to <body>', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="toolbar-section"><button class="toolbar-save-status" disabled>Read-only</button><button id="rec">Rec</button></div>';
    const scope = document.querySelector('.toolbar-section')!;
    const save = document.querySelector<HTMLButtonElement>('.toolbar-save-status')!;
    focusStableToolbarControl(scope);
    expect(document.activeElement).toBe(document.body);
    save.disabled = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(document.activeElement).toBe(save);
    vi.useRealTimers();
  });

  it('leaves focus alone when it already moved elsewhere', () => {
    document.body.innerHTML = '<div class="toolbar-section"><button class="toolbar-save-status">Saved</button></div><input id="other">';
    const other = document.getElementById('other') as HTMLInputElement;
    other.focus();
    focusStableToolbarControl(document.querySelector('.toolbar-section')!);
    expect(document.activeElement).toBe(other);
  });
});
