import { describe, expect, it } from 'vitest';

import { checkerWipe } from '../../src/transitions/checkerWipe';
import { doomBars } from '../../src/transitions/doomBars';
import { paintSplatter } from '../../src/transitions/paintSplatter';
import { polkaDotCurtain } from '../../src/transitions/polkaDotCurtain';
import { randomBlocks } from '../../src/transitions/randomBlocks';
import { venetianBlindsHorizontal } from '../../src/transitions/venetianBlindsHorizontal';
import { venetianBlindsVertical } from '../../src/transitions/venetianBlindsVertical';
import { zigZagBlocks } from '../../src/transitions/zigZagBlocks';

describe('pattern transition definitions', () => {
  it('defines a serializable checker wipe recipe', () => {
    expect(checkerWipe).toMatchObject({
      id: 'checker-wipe',
      name: 'Checker Wipe',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through a checkerboard pattern',
    });

    expect(JSON.parse(JSON.stringify(checkerWipe.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'checker',
      },
    ]);
  });

  it('defines serializable venetian blinds recipes', () => {
    expect(venetianBlindsHorizontal).toMatchObject({
      id: 'venetian-blinds-horizontal',
      name: 'Venetian Blinds Horizontal',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through staggered horizontal blinds',
    });
    expect(venetianBlindsVertical).toMatchObject({
      id: 'venetian-blinds-vertical',
      name: 'Venetian Blinds Vertical',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through staggered vertical blinds',
    });

    expect(JSON.parse(JSON.stringify(venetianBlindsHorizontal.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'venetian-horizontal',
      },
    ]);
    expect(JSON.parse(JSON.stringify(venetianBlindsVertical.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'venetian-vertical',
      },
    ]);
  });

  it('defines serializable block pattern recipes', () => {
    expect(randomBlocks).toMatchObject({
      id: 'random-blocks',
      name: 'Random Blocks',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through large seeded block tiles',
    });
    expect(zigZagBlocks).toMatchObject({
      id: 'zig-zag-blocks',
      name: 'Zig-Zag Blocks',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip behind a deterministic zig-zag block edge',
    });

    expect(JSON.parse(JSON.stringify(randomBlocks.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'random-blocks',
      },
    ]);
    expect(JSON.parse(JSON.stringify(zigZagBlocks.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'zig-zag',
      },
    ]);
  });

  it('defines serializable splat, dot, and bar pattern recipes', () => {
    expect(paintSplatter).toMatchObject({
      id: 'paint-splatter',
      name: 'Paint Splatter',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through seeded paint splatter cells',
    });
    expect(polkaDotCurtain).toMatchObject({
      id: 'polka-dot-curtain',
      name: 'Polka Dot Curtain',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through expanding dot cells',
    });
    expect(doomBars).toMatchObject({
      id: 'doom-bars',
      name: 'Doom Bars',
      category: 'pattern',
      defaultDuration: 1.1,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip through staggered vertical bars',
    });

    expect(JSON.parse(JSON.stringify(paintSplatter.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'paint-splatter',
      },
    ]);
    expect(JSON.parse(JSON.stringify(polkaDotCurtain.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'polka-dot',
      },
    ]);
    expect(JSON.parse(JSON.stringify(doomBars.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'pattern',
        pattern: 'doom-bars',
      },
    ]);
  });
});
