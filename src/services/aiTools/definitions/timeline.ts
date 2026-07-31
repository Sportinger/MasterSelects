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
      name: 'getTimelineRangeSelection',
      description: 'Read the exact painted timeline time range and track scope. Returns null when no range is active.',
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
      name: 'verifyTimelineInvariants',
      description: 'Read-only wrapper over the shared validation core from agent-kernel plan section 9.2. Verifies the live timeline against the default invariant set or caller-supplied checks without mutating timeline state.',
      parameters: {
        type: 'object',
        properties: {
          checks: {
            type: 'array',
            minItems: 1,
            description: 'Validation-core checks to evaluate. Omit to run every expectation-free default timeline invariant.',
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    check: { const: 'objectCount' },
                    args: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        kind: { enum: ['clip', 'clips', 'track', 'tracks'] },
                        expected: { type: 'integer', minimum: 0 },
                      },
                      required: ['kind', 'expected'],
                    },
                  },
                  required: ['check', 'args'],
                },
                ...['noGaps', 'noOverlaps', 'avLinkAlignment'].map((check) => ({
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    check: { const: check },
                    args: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {},
                    },
                  },
                  required: ['check'],
                })),
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    check: { const: 'sourceOrderMonotonic' },
                    args: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        trackId: { type: 'string', minLength: 1 },
                      },
                    },
                  },
                  required: ['check'],
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    check: { const: 'occupiedEnd' },
                    args: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        expected: { type: 'number', minimum: 0 },
                        tolerance: { type: 'number', minimum: 0 },
                      },
                      required: ['expected'],
                    },
                  },
                  required: ['check', 'args'],
                },
              ],
            },
          },
        },
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
