import type { ToolDefinition } from '../types';

export const transitionToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'addTransition',
      description: 'Add a transition between two adjacent clips. The clips must be on the same track and touching (no gap).',
      parameters: {
        type: 'object',
        properties: {
          clipAId: { type: 'string', description: 'The first clip ID (outgoing)' },
          clipBId: { type: 'string', description: 'The second clip ID (incoming)' },
          type: { type: 'string', description: 'Transition type. Supported: "crossfade", "dip-to-black", "dip-to-white", "wipe-left", "wipe-right".' },
          duration: { type: 'number', description: 'Transition duration in seconds (default: 2)' },
        },
        required: ['clipAId', 'clipBId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeTransition',
      description: 'Remove a transition from a clip edge.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          edge: { type: 'string', description: '"in" (start of clip) or "out" (end of clip)' },
        },
        required: ['clipId', 'edge'],
      },
    },
  },
];
