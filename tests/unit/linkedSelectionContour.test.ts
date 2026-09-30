import { describe, expect, it } from 'vitest';
import { getLinkedSelectionContour } from '../../src/components/timeline/utils/linkedSelectionContour';
import { getIndividualSelectionIds, getLinkedSelectionGroups } from '../../src/components/timeline/utils/linkedSelectionGroups';

describe('linked selection contours', () => {
  it('removes shared edges and follows staggered clip lengths', () => {
    const path = getLinkedSelectionContour([
      { left: 0, right: 100, top: 0, bottom: 20 },
      { left: 20, right: 80, top: 20, bottom: 40 },
    ]);
    expect(path).toContain('M0,20H20');
    expect(path).toContain('M80,20H100');
    expect(path).not.toContain('M0,20H100');
    expect(path).toContain('M20,40H80');
  });
  it('preserves empty gaps instead of spanning a bounding rectangle', () => {
    const path = getLinkedSelectionContour([
      { left: 0, right: 20, top: 0, bottom: 20 },
      { left: 40, right: 60, top: 0, bottom: 20 },
      { left: 0, right: 60, top: 20, bottom: 40 },
    ]);
    expect(path).toContain('M20,20H40');
    expect(path).not.toContain('M0,0H60');
  });
  it('joins reverse pairs and manual groups while preserving independent selections', () => {
    const clips = [
      { id: 'a', linkedGroupId: 'clip-link-1' },
      { id: 'b', linkedGroupId: 'clip-link-1', linkedClipId: 'c' },
      { id: 'c' }, { id: 'd' },
    ];
    const selected = new Set(['a', 'b', 'c', 'd']);
    expect(getLinkedSelectionGroups(clips, selected).map(group => group.map(clip => clip.id))).toEqual([['a', 'b', 'c']]);
    expect([...getIndividualSelectionIds(clips, selected)]).toEqual(['d']);
    expect([...getIndividualSelectionIds(clips, new Set(['a']))]).toEqual(['a']);
  });
});
