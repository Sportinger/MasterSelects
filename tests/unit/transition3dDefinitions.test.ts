import { describe, expect, it } from 'vitest';

import { cardSpin } from '../../src/transitions/cardSpin';
import { flipHorizontal } from '../../src/transitions/flipHorizontal';
import { flipVertical } from '../../src/transitions/flipVertical';
import { roll3d } from '../../src/transitions/roll3d';
import { spinback3d } from '../../src/transitions/spinback3d';
import { tumbleAway } from '../../src/transitions/tumbleAway';

describe('3D transition definitions', () => {
  it('defines a serializable horizontal flip recipe', () => {
    expect(flipHorizontal).toMatchObject({
      id: 'flip-horizontal',
      name: 'Flip Horizontal',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Flip between clips around the vertical axis',
    });
    expect(JSON.parse(JSON.stringify(flipHorizontal.recipe))).toEqual(flipHorizontal.recipe);
    expect(flipHorizontal.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateY: { from: 0, to: -Math.PI / 2 },
      translateZ: { from: 0, to: -0.12 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(flipHorizontal.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateY: { from: Math.PI / 2, to: 0 },
      translateZ: { from: -0.12, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    });
  });

  it('defines a serializable vertical flip recipe', () => {
    expect(flipVertical).toMatchObject({
      id: 'flip-vertical',
      name: 'Flip Vertical',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.2,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Flip between clips around the horizontal axis',
    });
    expect(JSON.parse(JSON.stringify(flipVertical.recipe))).toEqual(flipVertical.recipe);
    expect(flipVertical.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: Math.PI / 2 },
      translateZ: { from: 0, to: -0.12 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(flipVertical.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -Math.PI / 2, to: 0 },
      translateZ: { from: -0.12, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    });
  });

  it('defines a serializable card spin recipe', () => {
    expect(cardSpin).toMatchObject({
      id: 'card-spin',
      name: 'Card Spin',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.4,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Spin clips like a single card turning through the cut',
    });
    expect(JSON.parse(JSON.stringify(cardSpin.recipe))).toEqual(cardSpin.recipe);
    expect(cardSpin.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateY: { from: 0, to: Math.PI / 2 },
      rotateZ: { from: 0, to: 0.08 },
      scaleX: { from: 1, to: 0.94 },
      scaleY: { from: 1, to: 0.94 },
      translateZ: { from: 0, to: -0.18 },
      endProgress: 0.5,
      curve: 'ease-in',
    });
    expect(cardSpin.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateY: { from: -Math.PI / 2, to: 0 },
      rotateZ: { from: -0.08, to: 0 },
      scaleX: { from: 0.94, to: 1 },
      scaleY: { from: 0.94, to: 1 },
      translateZ: { from: -0.18, to: 0 },
      startProgress: 0.5,
      curve: 'ease-out',
    });
  });

  it('defines a serializable tumble away recipe', () => {
    expect(tumbleAway).toMatchObject({
      id: 'tumble-away',
      name: 'Tumble Away',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.3,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Tumble the outgoing clip backward as the next clip settles in',
    });
    expect(JSON.parse(JSON.stringify(tumbleAway.recipe))).toEqual(tumbleAway.recipe);
    expect(tumbleAway.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.92 },
      rotateY: { from: 0, to: -0.56 },
      rotateZ: { from: 0, to: -0.18 },
      translateY: { from: 0, to: 0.18 },
      translateZ: { from: 0, to: -0.28 },
      scaleX: { from: 1, to: 0.72 },
      scaleY: { from: 1, to: 0.72 },
      endProgress: 0.78,
      curve: 'ease-in',
    });
    expect(tumbleAway.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -0.18, to: 0 },
      rotateY: { from: 0.16, to: 0 },
      translateY: { from: -0.08, to: 0 },
      translateZ: { from: -0.18, to: 0 },
      scaleX: { from: 0.92, to: 1 },
      scaleY: { from: 0.92, to: 1 },
      startProgress: 0.32,
      curve: 'ease-out',
    });
  });

  it('defines a serializable 3D roll recipe', () => {
    expect(roll3d).toMatchObject({
      id: 'roll-3d',
      name: '3D Roll',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.3,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Roll clips through the cut around the horizontal axis',
    });
    expect(JSON.parse(JSON.stringify(roll3d.recipe))).toEqual(roll3d.recipe);
    expect(roll3d.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: -Math.PI / 2 },
      rotateZ: { from: 0, to: -0.1 },
      translateY: { from: 0, to: -0.06 },
      translateZ: { from: 0, to: -0.16 },
      scaleX: { from: 1, to: 0.96 },
      scaleY: { from: 1, to: 0.96 },
      endProgress: 0.52,
      curve: 'ease-in',
    });
    expect(roll3d.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: Math.PI / 2, to: 0 },
      rotateZ: { from: 0.1, to: 0 },
      translateY: { from: 0.06, to: 0 },
      translateZ: { from: -0.16, to: 0 },
      scaleX: { from: 0.96, to: 1 },
      scaleY: { from: 0.96, to: 1 },
      startProgress: 0.48,
      curve: 'ease-out',
    });
  });

  it('defines a serializable 3D spinback recipe', () => {
    expect(spinback3d).toMatchObject({
      id: 'spinback-3d',
      name: '3D Spinback',
      category: '3d',
      renderMode: 'scene-3d-panel',
      defaultDuration: 1.35,
      minDuration: 0.1,
      maxDuration: 5,
      description: 'Spin clips backward in depth through the cut',
    });
    expect(JSON.parse(JSON.stringify(spinback3d.recipe))).toEqual(spinback3d.recipe);
    expect(spinback3d.recipe).toContainEqual({
      kind: 'transform',
      target: 'outgoing',
      rotateX: { from: 0, to: 0.36 },
      rotateY: { from: 0, to: -0.74 },
      rotateZ: { from: 0, to: -0.92 },
      translateZ: { from: 0, to: -0.34 },
      scaleX: { from: 1, to: 0.62 },
      scaleY: { from: 1, to: 0.62 },
      endProgress: 0.68,
      curve: 'ease-in',
    });
    expect(spinback3d.recipe).toContainEqual({
      kind: 'transform',
      target: 'incoming',
      rotateX: { from: -0.24, to: 0 },
      rotateY: { from: 0.42, to: 0 },
      rotateZ: { from: 0.82, to: 0 },
      translateZ: { from: -0.32, to: 0 },
      scaleX: { from: 0.64, to: 1 },
      scaleY: { from: 0.64, to: 1 },
      startProgress: 0.32,
      curve: 'ease-out',
    });
  });
});
