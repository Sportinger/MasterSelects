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
      name: 'getTimelineTranscript',
      description: 'Read what is audibly spoken in the current edited timeline, already mapped into timeline time and deduplicated across linked video/audio pairs. The result respects trims, speed/reverse, clip mute, and effective track mute/solo. Use detail=segments for readable sentences or detail=words for exact edit evidence; follow nextCursor until complete.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          startTime: {
            type: 'number',
            minimum: 0,
            description: 'Optional timeline-time range start in seconds.',
          },
          endTime: {
            type: 'number',
            minimum: 0,
            description: 'Optional timeline-time range end in seconds.',
          },
          cursor: {
            type: 'integer',
            minimum: 0,
            description: 'Word offset inside the matching audible timeline transcript (default 0).',
          },
          timelineRevision: {
            type: 'integer',
            minimum: 0,
            description: 'Optional revision guard. Copy timelineRevision from the first page into later calls so pagination fails instead of mixing different edits.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 5000,
            description: 'Maximum words in this page (default 1000, maximum 5000).',
          },
          detail: {
            type: 'string',
            enum: ['text', 'segments', 'words'],
            description: 'text returns joined text, segments adds readable sentence/clip blocks, words adds exact word timing and source mappings (default segments).',
          },
        },
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
