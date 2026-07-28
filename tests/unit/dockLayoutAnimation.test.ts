import { describe, expect, it, vi } from 'vitest';

import {
  getSequenceExitPreludeRect,
  getSequenceAnimationTiming,
  getSequenceExitAnimationTiming,
  shouldAnimateLiveLayoutElement,
} from '../../src/components/dock/container/layoutAnimationMath';
import { captureDockLayoutAnimationSnapshot } from '../../src/components/dock/container/layoutAnimationSnapshot';

describe('dock layout animation', () => {
  it('animates the media panel live without cloning its contents', () => {
    const container = document.createElement('div');
    const mediaPanel = document.createElement('div');
    mediaPanel.dataset.dockLayoutAnimId = 'panel:media';
    mediaPanel.append(document.createElement('video'), document.createElement('canvas'));
    container.append(mediaPanel);

    vi.spyOn(mediaPanel, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 300, 200));
    const cloneSpy = vi.spyOn(mediaPanel, 'cloneNode');
    const snapshot = captureDockLayoutAnimationSnapshot(container, 500);

    expect(shouldAnimateLiveLayoutElement('panel:media')).toBe(true);
    expect(shouldAnimateLiveLayoutElement('panel:clip-properties')).toBe(false);
    expect(cloneSpy).not.toHaveBeenCalled();
    expect(snapshot.items.get('panel:media')).toMatchObject({
      clone: undefined,
      liveElement: mediaPanel,
    });
  });

  it('strongly overlaps the Start reveal across the full three-second window', () => {
    const media = getSequenceAnimationTiming('panel:media', 3000);
    const preview = getSequenceAnimationTiming('panel:preview', 3000);
    const tools = getSequenceAnimationTiming('panel:export', 3000);
    const timeline = getSequenceAnimationTiming('panel:timeline', 3000);

    expect([
      media.delayMs,
      preview.delayMs,
      tools.delayMs,
      timeline.delayMs,
    ]).toEqual([0, 450, 900, 1350]);
    expect(media.durationMs).toBe(1650);
    expect(preview.delayMs - media.delayMs).toBeLessThan(media.durationMs / 3);
    expect(tools.delayMs - preview.delayMs).toBeLessThan(preview.durationMs / 3);
    expect(timeline.delayMs - tools.delayMs).toBeLessThan(timeline.durationMs / 3);
    expect(timeline.delayMs + timeline.durationMs).toBe(3000);
  });

  it('strongly overlaps outgoing sequence stages across the full outro window', () => {
    const media = getSequenceExitAnimationTiming('panel:media', 3600);
    const preview = getSequenceExitAnimationTiming('panel:preview', 3600);
    const tools = getSequenceExitAnimationTiming('panel:export', 3600);
    const timeline = getSequenceExitAnimationTiming('panel:timeline', 3600);

    expect([
      media.delayMs,
      preview.delayMs,
      tools.delayMs,
      timeline.delayMs,
    ]).toEqual([360, 603, 846, 1089]);
    expect(media.durationMs).toBe(2511);
    expect(preview.delayMs - media.delayMs).toBeLessThan(media.durationMs / 10);
    expect(tools.delayMs - preview.delayMs).toBeLessThan(preview.durationMs / 10);
    expect(timeline.delayMs - tools.delayMs).toBeLessThan(timeline.durationMs / 10);
    expect(timeline.delayMs + timeline.durationMs).toBe(3600);
  });

  it('starts every outgoing panel with a subtle drift toward its exit edge', () => {
    const prelude = getSequenceExitPreludeRect(
      { left: 100, top: 50, width: 400, height: 300 },
      { left: -428, top: 50, width: 400, height: 300 },
      2000,
    );

    expect(prelude).toEqual({
      left: 76,
      top: 50,
      width: 400,
      height: 300,
    });
  });

  it('captures only top-level panes for a sequenced transition', () => {
    const container = document.createElement('div');
    const pane = document.createElement('div');
    const nestedTab = document.createElement('button');
    pane.className = 'dock-tab-pane';
    pane.dataset.dockLayoutAnimId = 'panel:media';
    nestedTab.dataset.dockLayoutAnimId = 'panel:transitions';
    pane.append(nestedTab);
    container.append(pane);

    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
    vi.spyOn(nestedTab, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 24));

    const snapshot = captureDockLayoutAnimationSnapshot(container, 3000, 'sequence');

    expect(snapshot.staggerMode).toBe('sequence');
    expect([...snapshot.items.keys()]).toEqual(['panel:media']);
  });

});
