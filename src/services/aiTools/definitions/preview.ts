// Preview & Frame Capture Tool Definitions

import type { ToolDefinition } from '../types';

export const previewToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'captureFrame',
      description: 'Capture the current composition output as a still image (screenshot). Returns a base64-encoded PNG.',
      parameters: {
        type: 'object',
        properties: {
          time: {
            type: 'number',
            description: 'Time in seconds to capture (optional, uses current playhead if not specified)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCutPreviewQuad',
      description: 'Get an 8-frame preview image showing frames around a cut point: 4 frames BEFORE and 4 frames AFTER. Returns a 4x2 grid image (top row: before, bottom row: after). Use this to evaluate if a cut will look smooth or jarring.',
      parameters: {
        type: 'object',
        properties: {
          cutTime: {
            type: 'number',
            description: 'The timeline time (in seconds) where the cut will happen',
          },
          frameSpacing: {
            type: 'number',
            description: 'Seconds between each frame (default: 0.1 = 100ms). Smaller = closer to cut point.',
          },
        },
        required: ['cutTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFramesAtTimes',
      description: 'Capture frames at specific timeline times and return as a grid image. Useful for comparing different moments or evaluating transitions.',
      parameters: {
        type: 'object',
        properties: {
          times: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of timeline times (in seconds) to capture frames at. Max 8 frames.',
          },
          columns: {
            type: 'number',
            description: 'Number of columns in the grid (default: 4)',
          },
        },
        required: ['times'],
      },
    },
  },
];
