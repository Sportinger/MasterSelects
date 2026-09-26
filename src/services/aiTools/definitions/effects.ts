import type { ToolDefinition } from '../types';

export const effectToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'listEffects',
      description: 'List all available effects grouped by category, with their parameters and default values.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addEffect',
      description: 'Add an effect to a clip. Use listEffects to see available effect types and their parameters.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          effectType: { type: 'string', description: 'Effect type ID from listEffects or a node-catalog typeId, e.g. "brightness", "gaussian-blur", "chroma-key", "pixel-particle-disintegrate". Catalog IDs such as "effect:glow" are accepted.' },
          params: { type: 'object', description: 'Optional initial parameter values. If not provided, defaults are used.' },
        },
        required: ['clipId', 'effectType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeEffect',
      description: 'Remove an effect from a clip.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          effectId: { type: 'string', description: 'The effect instance ID (from getClipDetails)' },
        },
        required: ['clipId', 'effectId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateEffect',
      description: 'Update parameters of an existing effect on a clip.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          effectId: { type: 'string', description: 'The effect instance ID' },
          params: { type: 'object', description: 'Parameter values to update' },
        },
        required: ['clipId', 'effectId', 'params'],
      },
    },
  },
];
