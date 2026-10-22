// Stick Figure presets: whole figures (pose, proportions, line and colour) that read on black.
// Every other card control returns to its default; the action lane is kept (EffectPreset).

import type { EffectPreset } from '../../types';

export const STICK_FIGURE_PRESETS: readonly EffectPreset[] = [
  {
    id: 'arabesque',
    name: 'Arabesque',
    // Standing leg straight, the other stretched back, one arm reaching forward and up; thin lines, a ring head.
    params: { spine: 20, head: -14, shoulderL: 150, elbowL: 10, shoulderR: -85, elbowR: 6, hipL: 0, kneeL: 0, hipR: -100, kneeR: 0,
      thickness: 8, headStyle: 'ring' },
  },
  {
    id: 'curtain-call',
    name: 'Curtain Call',
    // A deep bow, one hand to the chest and the other arm swept back, in warm stage-light gold.
    params: { spine: 55, head: 15, shoulderL: 75, elbowL: 120, shoulderR: -60, elbowR: 10, hipL: 2, kneeL: 2, hipR: -10, kneeR: 8,
      thickness: 11, color: '#ffd27a' },
  },
  {
    id: 'walking-man',
    name: 'Walking Man',
    // Long thin limbs and a small head in mid-stride, bronze-grey: a sculpture rather than a cartoon.
    params: { torso: 140, neck: 22, headRadius: 15, upperArm: 80, forearm: 78, thigh: 100, shin: 98, thickness: 7,
      spine: 10, head: -2, shoulderL: 6, elbowL: 4, shoulderR: -10, elbowR: 6, hipL: 22, kneeL: 4, hipR: -20, kneeR: 8, color: '#a8987c' },
  },
  {
    id: 'pictogram',
    name: 'Pictogram',
    // The running figure of a sign: bold lines, a large filled head, signal green.
    params: { spine: 18, head: -5, shoulderL: 60, elbowL: 80, shoulderR: -55, elbowR: 60, hipL: 70, kneeL: 80, hipR: -35, kneeR: 75,
      thickness: 26, headRadius: 32, color: '#2fbf71' },
  },
];
