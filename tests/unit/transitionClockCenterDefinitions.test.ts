import { describe, expect, it } from 'vitest';

import { barnDoorHorizontal } from '../../src/transitions/barnDoorHorizontal';
import { barnDoorVertical } from '../../src/transitions/barnDoorVertical';
import { centerWipe } from '../../src/transitions/centerWipe';
import { clockWipe } from '../../src/transitions/clockWipe';

describe('clock and center wipe transition definitions', () => {
  it('defines a serializable clockwise mask recipe', () => {
    expect(clockWipe).toMatchObject({
      id: 'clock-wipe',
      name: 'Clock Wipe',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5,
      description: "Clock reveals clockwise from 12 o'clock",
    });
    expect(clockWipe.recipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'clock',
        clockwise: true,
        angleOffset: 0,
      },
    ]);
    expect(JSON.parse(JSON.stringify(clockWipe.recipe))).toEqual(clockWipe.recipe);
  });

  it('defines a serializable center-out mask recipe', () => {
    expect(centerWipe).toMatchObject({
      id: 'center-wipe',
      name: 'Center Wipe',
      category: 'wipe',
      defaultDuration: 2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Center reveals incoming from the center outward',
    });
    expect(centerWipe.recipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'center',
        axis: 'x',
      },
    ]);
    expect(JSON.parse(JSON.stringify(centerWipe.recipe))).toEqual(centerWipe.recipe);
  });

  it('defines serializable barn door mask recipes', () => {
    expect(barnDoorHorizontal).toMatchObject({
      id: 'barn-door-horizontal',
      name: 'Barn Door Horizontal',
      category: 'wipe',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip from the center outward horizontally',
    });
    expect(barnDoorVertical).toMatchObject({
      id: 'barn-door-vertical',
      name: 'Barn Door Vertical',
      category: 'wipe',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Reveal the incoming clip from the center outward vertically',
    });
    expect(barnDoorHorizontal.recipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'center',
        axis: 'x',
      },
    ]);
    expect(barnDoorVertical.recipe).toEqual([
      {
        kind: 'mask',
        target: 'incoming',
        mask: 'center',
        axis: 'y',
      },
    ]);
    expect(JSON.parse(JSON.stringify(barnDoorHorizontal.recipe))).toEqual(barnDoorHorizontal.recipe);
    expect(JSON.parse(JSON.stringify(barnDoorVertical.recipe))).toEqual(barnDoorVertical.recipe);
  });
});
