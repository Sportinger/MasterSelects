import { describe, expect, it } from 'vitest';

import { getAllTransitions } from '../../src/transitions';
import {
  filterTransitionPanelItems,
  groupTransitionPanelItems,
  sectionTransitionPanelItems,
} from '../../src/components/panels/transitions/transitionPanelItems';

describe('transition panel items', () => {
  it('keeps grouping and search usable once the registry has at least 60 definitions', () => {
    const transitions = getAllTransitions();
    const items = groupTransitionPanelItems(transitions);
    const sections = sectionTransitionPanelItems(items);

    expect(transitions.length).toBeGreaterThanOrEqual(60);
    expect(items.length).toBeLessThan(transitions.length / 2);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(sections.map((section) => section.label)).toEqual(['2D', '3D']);
    expect(sections.flatMap((section) => section.items.map((item) => item.key)).toSorted())
      .toEqual(items.map((item) => item.key).toSorted());

    const searchExpectations = [
      ['barn door center clock', ['wipe']],
      ['projector flickers', ['light']],
      ['lens flares burn chroma', ['light']],
      ['venetian blinds', ['pattern']],
      ['puzzle pieces', ['pattern']],
      ['magnetic tiles', ['pattern']],
      ['tumble depth', ['tumble']],
      ['kaleidoscope prism', ['stylize']],
      ['whip pan speed', ['motion-blur']],
    ] as const;

    for (const [query, expectedKeys] of searchExpectations) {
      expect(filterTransitionPanelItems(items, query).map((item) => item.key)).toEqual(expectedKeys);
    }
  });

  it('collapses transition variants into 2D and 3D family cards', () => {
    const items = groupTransitionPanelItems(getAllTransitions());
    const sections = sectionTransitionPanelItems(items);

    expect(items.map((item) => item.key)).toEqual([
      'dissolve',
      'dip',
      'wipe',
      'iris',
      'push',
      'slide',
      'light',
      'stylize',
      'rotate',
      'glitch',
      'pattern',
      'flip',
      'spin',
      'tumble',
      'roll',
      'zoom',
      'motion-blur',
    ]);
    expect(items.find((item) => item.key === 'wipe')?.transition.id).toBe('wipe-left');
    expect(items.find((item) => item.key === 'flip')?.dimension).toBe('3d');
    expect(items.find((item) => item.key === 'flip')?.variantCount).toBe(2);
    expect(items.find((item) => item.key === 'flip')?.variants.map((variant) => variant.id))
      .toEqual(['flip-horizontal', 'flip-vertical']);
    expect(items.find((item) => item.key === 'tumble')?.variantCount).toBe(1);
    expect(items.find((item) => item.key === 'spin')?.variantCount).toBe(2);
    expect(items.find((item) => item.key === 'spin')?.variants.map((variant) => variant.id))
      .toEqual(['card-spin', 'spinback-3d']);
    expect(items.find((item) => item.key === 'rotate')?.variantCount).toBe(3);
    expect(items.find((item) => item.key === 'pattern')?.variantCount).toBe(10);
    expect(items.find((item) => item.key === 'stylize')?.variantCount).toBe(4);
    expect(items.some((item) => item.key === 'wipe-up')).toBe(false);
    expect(items.some((item) => item.key === 'light-leak')).toBe(false);

    expect(sections.map((section) => [section.label, section.items.length])).toEqual([
      ['2D', 13],
      ['3D', 4],
    ]);
    expect(sections.find((section) => section.label === '3D')?.items.map((item) => item.key))
      .toEqual(['flip', 'tumble', 'roll', 'spin']);
  });

  it('searches hidden variants, aliases, descriptions, and plural forms', () => {
    const items = groupTransitionPanelItems(getAllTransitions());

    expect(filterTransitionPanelItems(items, 'barn door').map((item) => item.key)).toEqual(['wipe']);
    expect(filterTransitionPanelItems(items, 'leaks').map((item) => item.key)).toEqual(['light']);
    expect(filterTransitionPanelItems(items, 'flat quarter').map((item) => item.key)).toEqual(['rotate']);
    expect(filterTransitionPanelItems(items, 'roll depth').map((item) => item.key)).toEqual(['roll']);
    expect(filterTransitionPanelItems(items, 'spin blur').map((item) => item.key)).toEqual(['zoom']);
    expect(filterTransitionPanelItems(items, 'mirrored prism').map((item) => item.key)).toEqual(['stylize']);
  });
});
