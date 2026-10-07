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
          deClickFadeSeconds: {
            type: 'number',
            minimum: 0,
            maximum: 0.02,
            description: 'Automatic audio fade on newly exposed cut edges (default: 0.012 seconds; set 0 to disable)',
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
          deClickFadeSeconds: {
            type: 'number',
            minimum: 0,
            maximum: 0.02,
            description: 'Automatic audio fade on newly exposed cut edges (default: 0.012 seconds; set 0 to disable)',
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
          deClickFadeSeconds: {
            type: 'number',
            minimum: 0,
            maximum: 0.02,
            description: 'Automatic audio fade on every newly exposed cut edge (default: 0.012 seconds; set 0 to disable)',
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
      name: 'addCompositionClip',
      description: 'Place an existing composition as a nested composition clip on the active timeline, like dragging it from the Media panel. Use it to build scenes, reusable lower thirds or templates as their own compositions and stack them in a parent composition. The clip has the composition duration and normal transform, effects and keyframes.',
      parameters: {
        type: 'object',
        properties: {
          compositionId: { type: 'string', description: 'ID of the composition to nest (from getMediaItems or createComposition). It must not be the active composition or contain it.' },
          trackId: { type: ['string', 'null'], description: 'Video track ID, or null/omitted for the first video track that is free for the range (a new one is created when none is free).' },
          startTime: { type: 'number', description: 'Timeline start in seconds (default 0).' },
        },
        required: ['compositionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'addClipSegment',
      description: 'Add a clip segment from the media pool to the timeline. Imports only a specific time range (inPoint to outPoint) from a media file. For video files, automatically creates linked audio on the first free audio track (a new one when none is free). Much more efficient than importing the full clip and then splitting.',
      parameters: {
        type: 'object',
        properties: {
          mediaFileId: {
            type: 'string',
            description: 'ID of the media file in the media pool (from getMediaItems)',
          },
          trackId: {
            type: ['string', 'null'],
            description: 'ID of the track to add the clip to, or null to use the first compatible active-composition track that is free for the range (a new track is created when none is free). An explicit track must be free for the whole range; overlapping clips are rejected.',
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
            description: 'Automatic audio fade duration on both inserted segment edges (default: 0.012 seconds; set 0 to disable)',
          },
          visualScaleMode: {
            type: 'string',
            enum: ['fit', 'fill', 'original'],
            description: 'Visual placement mode: fit keeps the whole source visible, fill covers the composition and may crop, original keeps native pixel size. Ignored for audio-only media.',
          },
        },
        required: ['mediaFileId', 'trackId', 'startTime', 'inPoint', 'outPoint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createSolidClip',
      description: 'Create a solid color clip on a video track. blank: true (or color "#00000000") makes a transparent Blank clip to host generator effects (Stick Figure, particles).',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Unlocked video track (default: first unlocked video track).' },
          start: { type: 'number', description: 'Timeline start in seconds (default: playhead).' },
          duration: { type: 'number', description: 'Duration in seconds (default 5).' },
          color: { type: 'string', description: 'Fill as #rrggbb or #rrggbbaa (default #ffffff).' },
          blank: { type: 'boolean', description: 'Transparent Blank clip; overrides color.' },
          name: { type: 'string', description: 'Clip name.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createMidiClip',
      description: 'Create a MIDI clip with notes on a MIDI track (createTrack type "midi" with an instrument preset). Note times are clip seconds.',
      parameters: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'MIDI track (default: first unlocked MIDI track).' },
          start: { type: 'number', description: 'Timeline start in seconds (default: playhead).' },
          duration: { type: 'number', description: 'Clip duration in seconds (default: covers the notes, at least 1).' },
          notes: {
            type: 'array',
            description: 'Notes: { time (clip seconds), pitch (MIDI 0..127, 60 = C4), duration? (default 0.15), velocity? (0..1, default 0.85) }.',
            items: {
              type: 'object',
              properties: {
                time: { type: 'number' }, pitch: { type: 'integer' }, duration: { type: 'number' }, velocity: { type: 'number' },
              },
              required: ['time', 'pitch'],
            },
          },
          name: { type: 'string', description: 'Clip name.' },
        },
        required: [],
      },
    },
  },
];
