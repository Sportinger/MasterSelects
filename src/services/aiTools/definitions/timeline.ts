// Timeline State Tool Definitions

import type { ToolDefinition } from '../types';

export const timelineToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getTimelineState',
      description: 'Get the current state of the timeline including all tracks, clips, playhead position, and duration. Always call this first to understand the current state before making changes.',
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
      name: 'setPlayhead',
      description: 'Move the playhead to a specific time position.',
      parameters: {
        type: 'object',
        properties: {
          time: {
            type: 'number',
            description: 'Time in seconds to move the playhead to',
          },
        },
        required: ['time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setInOutPoints',
      description: 'Set the in and out points for playback range or export.',
      parameters: {
        type: 'object',
        properties: {
          inPoint: {
            type: 'number',
            description: 'In point time in seconds (null to clear)',
          },
          outPoint: {
            type: 'number',
            description: 'Out point time in seconds (null to clear)',
          },
        },
        required: [],
      },
    },
  },
];
