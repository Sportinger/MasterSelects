import { describe, expect, it } from 'vitest';

import { circleIris } from '../../src/transitions/circleIris';
import { crossIris } from '../../src/transitions/crossIris';
import { diamondIris } from '../../src/transitions/diamondIris';
import { ovalIris } from '../../src/transitions/ovalIris';
import { squareIris } from '../../src/transitions/squareIris';
import { starIris } from '../../src/transitions/starIris';
import { triangleIris } from '../../src/transitions/triangleIris';

describe('iris transition definitions', () => {
  it('defines a serializable circle iris recipe', () => {
    expect(circleIris).toMatchObject({
      id: 'circle-iris',
      name: 'Circle Iris',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip from the center using a circle iris shape',
    });
    expect(JSON.parse(JSON.stringify(circleIris.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'shape',
        shape: 'circle',
      },
    ]);
  });

  it('defines a serializable diamond iris recipe', () => {
    expect(diamondIris).toMatchObject({
      id: 'diamond-iris',
      name: 'Diamond Iris',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip from the center using a diamond iris shape',
    });
    expect(JSON.parse(JSON.stringify(diamondIris.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'shape',
        shape: 'diamond',
      },
    ]);
  });

  it('defines a serializable square iris recipe', () => {
    expect(squareIris).toMatchObject({
      id: 'square-iris',
      name: 'Square Iris',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip from the center using a square iris shape',
    });
    expect(JSON.parse(JSON.stringify(squareIris.recipe))).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'shape',
        shape: 'rect',
      },
    ]);
  });

  it('defines additional serializable shape iris recipes', () => {
    expect(ovalIris).toMatchObject({
      id: 'oval-iris',
      name: 'Oval Iris',
      category: 'wipe',
      description: 'Reveal the incoming clip from the center using an oval iris shape',
    });
    expect(triangleIris).toMatchObject({
      id: 'triangle-iris',
      name: 'Triangle Iris',
      category: 'wipe',
      description: 'Reveal the incoming clip from the center using a triangle iris shape',
    });
    expect(crossIris).toMatchObject({
      id: 'cross-iris',
      name: 'Cross Iris',
      category: 'wipe',
      description: 'Reveal the incoming clip from the center using a cross iris shape',
    });
    expect(starIris).toMatchObject({
      id: 'star-iris',
      name: 'Star Iris',
      category: 'wipe',
      description: 'Reveal the incoming clip from the center using a star iris shape',
    });

    expect(JSON.parse(JSON.stringify(ovalIris.recipe))).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'oval' },
    ]);
    expect(JSON.parse(JSON.stringify(triangleIris.recipe))).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'triangle' },
    ]);
    expect(JSON.parse(JSON.stringify(crossIris.recipe))).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'cross' },
    ]);
    expect(JSON.parse(JSON.stringify(starIris.recipe))).toEqual([
      { kind: 'mask', target: 'incoming', mask: 'shape', shape: 'star' },
    ]);
  });
});
