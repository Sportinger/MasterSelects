import type { ToolDefinition } from '../types';

export const keyframeToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getKeyframes',
      description: 'Get all keyframes for a clip, optionally filtered by property.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          property: { type: 'string', description: 'Filter by property name (e.g. "position.x", "opacity", "scale.all", "scale.x", "rotation.z", "speed")' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addKeyframe',
      description: 'Add a keyframe to animate a clip property over time. Time is relative to the clip start (0 = clip start).',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          property: { type: 'string', description: 'Property to animate: position.x, position.y, position.z, scale.all, scale.x, scale.y, scale.z, rotation.x, rotation.y, rotation.z, opacity, speed' },
          value: { type: 'number', description: 'Value at this keyframe' },
          time: { type: 'number', description: 'Time in seconds relative to clip start. If omitted, uses current playhead position relative to clip.' },
          easing: { type: 'string', description: 'Easing: linear, ease-in, ease-out, ease-in-out, bezier. Legacy aliases like easeOut are also accepted (default: ease-in-out).' },
        },
        required: ['clipId', 'property', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeKeyframe',
      description: 'Remove a keyframe by ID.',
      parameters: {
        type: 'object',
        properties: {
          keyframeId: { type: 'string', description: 'The keyframe ID (from getKeyframes)' },
        },
        required: ['keyframeId'],
      },
    },
  },
];
