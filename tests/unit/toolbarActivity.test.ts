import { describe, expect, it, vi } from 'vitest';
import { beginBackgroundActivity, getBackgroundActivity, subscribeBackgroundActivity } from '../../src/services/activity/backgroundActivity';
import { describeToolbarActivity } from '../../src/components/common/toolbar/toolbarActivityText';

describe('background activity', () => {
  it('counts running jobs per kind, ends each once and returns to one idle snapshot', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBackgroundActivity(listener);
    const idle = getBackgroundActivity();
    const decoder = beginBackgroundActivity('decoders');
    const thumbs = beginBackgroundActivity('thumbnails');
    expect(getBackgroundActivity()).toEqual({ decoders: 1, thumbnails: 1 });
    decoder(); decoder();
    expect(getBackgroundActivity()).toEqual({ decoders: 0, thumbnails: 1 });
    thumbs();
    expect(getBackgroundActivity()).toBe(idle);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });
});

describe('toolbar activity text', () => {
  it('leads with what keeps the preview waiting and lists the rest in the tooltip', () => {
    const lines = describeToolbarActivity({ connecting: false, decoders: 3, thumbnails: 2, verification: { files: 2, bytesDone: 5e9, bytesTotal: 20e9 } });
    expect(lines.map(line => line.label)).toEqual(['Loading media…', 'Building thumbnails…', 'Verifying media 25 %']);
    expect(lines[0]!.detail).toContain('3 sources');
    expect(lines[2]!.percent).toBe(25);
    expect(describeToolbarActivity({ connecting: false, decoders: 0, thumbnails: 0, verification: null })).toEqual([]);
    expect(describeToolbarActivity({ connecting: true, decoders: 0, thumbnails: 0, verification: null })[0]!.label).toBe('Connecting media…');
  });
});
