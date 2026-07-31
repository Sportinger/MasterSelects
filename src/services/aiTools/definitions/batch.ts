// Batch Execution Tool Definition

import type { ToolDefinition } from '../types';

export const batchToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'executeBatch',
      description: 'Execute multiple timeline/media actions in sequence with one undo point. This is not transactional: if one action fails, successful sibling actions remain applied, so inspect every returned result and repair only failures. Each action gets fresh state. To pass an earlier result into a later action, use {"$batchResult":{"action":0,"path":"clipId"}} as an argument value; action is the zero-based earlier action index and path is a dot path inside its data. Use bare tool names such as splitClip, never namespaced names such as functions.splitClip.',
      parameters: {
        type: 'object',
        properties: {
          actions: {
            type: 'array',
            description: 'Array of actions to execute in order',
            items: {
              type: 'object',
              properties: {
                tool: {
                  type: 'string',
                  description: 'The tool name to execute (e.g. splitClip, deleteClip, moveClip)',
                },
                args: {
                  type: 'object',
                  description: 'Arguments for the tool. Any value may reference successful earlier action data with {"$batchResult":{"action":0,"path":"clipId"}}.',
                },
              },
              required: ['tool', 'args'],
            },
          },
          staggerDelayMs: {
            type: 'number',
            description: 'Delay between actions in ms for visual stagger effect (default: auto-calculated so total batch takes max 3s, set to 0 for instant)',
          },
        },
        required: ['actions'],
      },
    },
  },
];
