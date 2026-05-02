import type { MathSceneDefinition } from '../../types';
import { createDefaultMathScene } from './defaultScene';

export type MathSceneTemplateId =
  | 'derivative-sine'
  | 'parabola-vertex'
  | 'wave-interference'
  | 'unit-circle'
  | 'fourier-series';

export const MATH_SCENE_TEMPLATES: Array<{ id: MathSceneTemplateId; name: string }> = [
  { id: 'derivative-sine', name: 'Derivative' },
  { id: 'parabola-vertex', name: 'Parabola' },
  { id: 'wave-interference', name: 'Waves' },
  { id: 'unit-circle', name: 'Circle' },
  { id: 'fourier-series', name: 'Fourier' },
];

export function createMathSceneTemplate(id: MathSceneTemplateId): MathSceneDefinition {
  const scene = createDefaultMathScene();

  if (id === 'parabola-vertex') {
    return {
      ...scene,
      viewport: { ...scene.viewport, xMin: -5, xMax: 5, yMin: -2, yMax: 8 },
      parameters: [
        {
          id: 'param-a',
          name: 'a',
          value: -2,
          min: -4,
          max: 4,
          step: 0.01,
          animation: {
            enabled: true,
            from: -2.5,
            to: 2.5,
            startTime: 0.5,
            endTime: 4.2,
            easing: 'ease-in-out',
          },
        },
      ],
      objects: [
        {
          id: 'function-1',
          type: 'function',
          name: 'f(x)',
          expression: '(x-a)^2',
          samples: 520,
          stroke: '#38bdf8',
          strokeWidth: 4,
          visible: true,
          opacity: 1,
          animation: { reveal: { enabled: true, startTime: 0.2, endTime: 1.2 } },
        },
        {
          id: 'point-1',
          type: 'point',
          name: 'V',
          xExpression: 'a',
          yExpression: '0',
          radius: 10,
          fill: '#f97316',
          stroke: '#ffffff',
          labelVisible: true,
          visible: true,
          opacity: 1,
        },
        {
          id: 'label-1',
          type: 'label',
          name: 'Formula',
          text: 'f(x) = (x-a)^2',
          xExpression: '-4.6',
          yExpression: '7.1',
          fontSize: 44,
          color: '#d8dee9',
          visible: true,
          opacity: 1,
        },
      ],
    };
  }

  if (id === 'wave-interference') {
    return {
      ...scene,
      viewport: { ...scene.viewport, xMin: -8, xMax: 8, yMin: -3, yMax: 3 },
      parameters: [
        {
          id: 'param-a',
          name: 'a',
          value: 0,
          min: 0,
          max: 6.28,
          step: 0.01,
          animation: {
            enabled: true,
            from: 0,
            to: 6.28,
            startTime: 0,
            endTime: 5,
            easing: 'linear',
          },
        },
      ],
      objects: [
        {
          id: 'function-1',
          type: 'function',
          name: 'Wave A',
          expression: 'sin(x+a)',
          samples: 720,
          stroke: '#5eead4',
          strokeWidth: 3,
          visible: true,
          opacity: 0.75,
        },
        {
          id: 'function-2',
          type: 'function',
          name: 'Wave B',
          expression: 'sin(2*x-a)/2',
          samples: 720,
          stroke: '#f97316',
          strokeWidth: 3,
          visible: true,
          opacity: 0.75,
        },
        {
          id: 'function-3',
          type: 'function',
          name: 'Sum',
          expression: 'sin(x+a)+sin(2*x-a)/2',
          samples: 720,
          stroke: '#facc15',
          strokeWidth: 5,
          visible: true,
          opacity: 1,
        },
      ],
    };
  }

  if (id === 'unit-circle') {
    return {
      ...scene,
      viewport: { ...scene.viewport, xMin: -1.6, xMax: 1.6, yMin: -1.2, yMax: 1.2 },
      parameters: [
        {
          id: 'param-a',
          name: 'a',
          value: 0,
          min: 0,
          max: 6.28,
          step: 0.01,
          animation: {
            enabled: true,
            from: 0,
            to: 6.28,
            startTime: 0.2,
            endTime: 4.8,
            easing: 'linear',
          },
        },
      ],
      objects: [
        {
          id: 'function-1',
          type: 'function',
          name: 'Upper Circle',
          expression: 'sqrt(1-x^2)',
          domain: [-1, 1],
          samples: 360,
          stroke: '#5eead4',
          strokeWidth: 4,
          visible: true,
          opacity: 1,
        },
        {
          id: 'function-2',
          type: 'function',
          name: 'Lower Circle',
          expression: '-sqrt(1-x^2)',
          domain: [-1, 1],
          samples: 360,
          stroke: '#5eead4',
          strokeWidth: 4,
          visible: true,
          opacity: 1,
        },
        {
          id: 'point-1',
          type: 'point',
          name: 'P',
          xExpression: 'cos(a)',
          yExpression: 'sin(a)',
          radius: 10,
          fill: '#f97316',
          stroke: '#ffffff',
          labelVisible: true,
          visible: true,
          opacity: 1,
        },
      ],
    };
  }

  if (id === 'fourier-series') {
    return {
      ...scene,
      viewport: { ...scene.viewport, xMin: -7, xMax: 7, yMin: -2.2, yMax: 2.2 },
      parameters: [],
      objects: [
        {
          id: 'function-1',
          type: 'function',
          name: 'Fourier',
          expression: 'sin(x)+sin(3*x)/3+sin(5*x)/5+sin(7*x)/7',
          samples: 900,
          stroke: '#facc15',
          strokeWidth: 5,
          visible: true,
          opacity: 1,
          animation: { reveal: { enabled: true, startTime: 0.2, endTime: 2.8 } },
        },
        {
          id: 'label-1',
          type: 'label',
          name: 'Formula',
          text: 'partial Fourier series',
          xExpression: '-6.4',
          yExpression: '1.8',
          fontSize: 40,
          color: '#d8dee9',
          visible: true,
          opacity: 1,
        },
      ],
    };
  }

  return scene;
}
