// Clip Editing Tool Definitions

import type { ToolDefinition } from '../types';

export const clipToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getClipDetails',
      description: 'Get detailed information about a specific clip including analysis data, waveform status, transcript, effects, and transform properties.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to get details for',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClipsInTimeRange',
      description: 'Get all clips that overlap with a specific time range.',
      parameters: {
        type: 'object',
        properties: {
          startTime: {
            type: 'number',
            description: 'Start time in seconds',
          },
          endTime: {
            type: 'number',
            description: 'End time in seconds',
          },
          trackType: {
            type: 'string',
            enum: ['video', 'audio', 'all'],
            description: 'Filter by track type (default: all)',
          },
        },
        required: ['startTime', 'endTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'splitClip',
      description: 'Split a clip at a specific time, creating two separate clips. Also splits linked audio/video clip when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to split',
          },
          splitTime: {
            type: 'number',
            description: 'The time in seconds (timeline time, not clip-relative) where to split',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clip (default: true). Set false to edit only this clip.',
          },
        },
        required: ['clipId', 'splitTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteClip',
      description: 'Delete a clip from the timeline. Also deletes linked audio/video clip when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to delete',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clip (default: true). Set false to delete only this clip.',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteClips',
      description: 'Delete multiple clips from the timeline at once. Also deletes linked audio/video clips when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs to delete',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clips (default: true). Set false to delete only the specified clips.',
          },
        },
        required: ['clipIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveClip',
      description: 'Move a clip to a new position and/or track. Also moves linked audio/video clip when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to move',
          },
          newStartTime: {
            type: 'number',
            description: 'New start time in seconds',
          },
          newTrackId: {
            type: 'string',
            description: 'ID of the track to move the clip to (optional, keeps current track if not specified)',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clip (default: true). Set false to move only this clip.',
          },
        },
        required: ['clipId', 'newStartTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trimClip',
      description: 'Trim a clip by adjusting its in and out points (relative to the source media).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to trim',
          },
          inPoint: {
            type: 'number',
            description: 'New in point in seconds (relative to source media start)',
          },
          outPoint: {
            type: 'number',
            description: 'New out point in seconds (relative to source media start)',
          },
        },
        required: ['clipId', 'inPoint', 'outPoint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cutRangesFromClip',
      description: 'Remove multiple TIMELINE ranges from one clip in a single call. This is the preferred tool for low-quality ranges and for the complement of face-analysis KEEP ranges. It handles clip-ID changes from its own splits by processing end-to-start and applies the cuts to linked audio automatically; set ripple to true to close each removed gap. Do not pre-split the clip or delete its audio separately.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to edit',
          },
          ranges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                timelineStart: { type: 'number', description: 'Start time on timeline (seconds)' },
                timelineEnd: { type: 'number', description: 'End time on timeline (seconds)' },
              },
              required: ['timelineStart', 'timelineEnd'],
            },
            description: 'Ranges to REMOVE in timeline seconds. Use returned ranges directly for low-quality removal. To keep one analyzed person, merge that person\'s getClipFaceAnalysis appearance ranges, compute their complement inside the returned timelineRange, and pass the complement here.',
          },
          ripple: {
            type: 'boolean',
            description: 'Close each removed timeline gap by shifting later clips on the affected video/audio tracks (default: false).',
          },
        },
        required: ['clipId', 'ranges'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'splitClipEvenly',
      description: 'Split a clip into N equal parts. This is much faster than using executeBatch with individual splitClip calls. Also splits linked audio/video clip when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to split',
          },
          parts: {
            type: 'number',
            description: 'Number of equal parts to split into (minimum 2)',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clip (default: true). Set false to split only this clip.',
          },
        },
        required: ['clipId', 'parts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'splitClipAtTimes',
      description: 'Split a clip at multiple specific times in a single operation. This is much faster than using executeBatch with individual splitClip calls. Also splits linked audio/video clip when withLinked is true (default).',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to split',
          },
          times: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of timeline times (in seconds) where to split the clip',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clip (default: true). Set false to split only this clip.',
          },
        },
        required: ['clipId', 'times'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reorderClips',
      description: 'Reorder clips by placing them sequentially in the given order. Provide clip IDs in the desired playback order — the tool calculates all new positions and moves everything in a single operation. Also moves linked audio/video clips when withLinked is true (default). Much faster and more reliable than using executeBatch with multiple moveClip calls.',
      parameters: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs in the desired playback order. Clips will be placed sequentially starting from the earliest clip position.',
          },
          startTime: {
            type: 'number',
            description: 'Optional timeline position for the first reordered clip. Defaults to the earliest current position.',
          },
          withLinked: {
            type: 'boolean',
            description: 'Also apply to linked audio/video clips (default: true). Set false to reorder only the specified clips.',
          },
        },
        required: ['clipIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'selectClips',
      description: 'Select one or more clips in the timeline.',
      parameters: {
        type: 'object',
        properties: {
          clipIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs to select',
          },
        },
        required: ['clipIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clearSelection',
      description: 'Clear the current clip selection.',
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
      name: 'addClipSegment',
      description: 'Add a clip segment from the media pool to the timeline. Imports only a specific time range (inPoint to outPoint) from a media file. For video files, automatically creates linked audio. Much more efficient than importing the full clip and then splitting.',
      parameters: {
        type: 'object',
        properties: {
          mediaFileId: {
            type: 'string',
            description: 'ID of the media file in the media pool (from getMediaItems)',
          },
          trackId: {
            type: ['string', 'null'],
            description: 'ID of the track to add the clip to, or null to select the first compatible active-composition track',
          },
          startTime: {
            type: 'number',
            description: 'Position on the timeline in seconds where the clip should be placed',
          },
          inPoint: {
            type: 'number',
            description: 'Start time within the source file in seconds',
          },
          outPoint: {
            type: 'number',
            description: 'End time within the source file in seconds',
          },
          deClickFadeSeconds: {
            type: 'number',
            minimum: 0,
            maximum: 0.02,
            description: 'Optional automatic audio fade duration on both inserted segment edges (0-0.02 seconds)',
          },
        },
        required: ['mediaFileId', 'trackId', 'startTime', 'inPoint', 'outPoint'],
      },
    },
  },
];
