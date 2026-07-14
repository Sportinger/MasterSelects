import { describe, expect, it, vi } from 'vitest';

import { shouldAnimateLiveLayoutElement } from '../../src/components/dock/container/layoutAnimationMath';
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
});
