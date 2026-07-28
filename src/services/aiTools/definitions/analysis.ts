// Analysis & Transcript Tool Definitions

import type { ToolDefinition } from '../types';

export const analysisToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getTimelineAnalysis',
      description: 'Read the unified Agent Timeline for one bounded selected source range. Defaults to the selected clip or media file; supports canonical source, clip-local, or current-composition time with honest occurrence mappings. Returns events, occurrence projections, coverage, missing channels, and an opaque cursor. Transcript and scene-description strings are withheld unless includeText and explicit externalDataConsent are both supplied. Never returns frames or screenshots.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'Optional exact timeline clip. Defaults to the primary selected clip.',
          },
          mediaFileId: {
            type: 'string',
            description: 'Optional exact source media ID. Must match clipId when both are supplied.',
          },
          compositionId: {
            type: 'string',
            description: 'Composition scope for composition-time reads. Defaults to the active composition.',
          },
          compositionPath: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Optional exact root-to-leaf composition path.',
          },
          start: {
            type: 'number',
            minimum: 0,
            description: 'Inclusive range start in the requested time domain.',
          },
          end: {
            type: 'number',
            exclusiveMinimum: 0,
            description: 'Exclusive range end in the requested time domain.',
          },
          timeDomain: {
            type: 'string',
            enum: ['source', 'clip-local', 'composition'],
            description: 'Coordinate system for start/end. Non-source reads require a real occurrence mapping.',
          },
          granularity: {
            type: 'string',
            enum: ['summary', 'shot', 'event', 'sample'],
            description: 'Requested event granularity (default event).',
          },
          channels: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: {
              type: 'string',
              enum: [
                'cuts', 'shots', 'scenes', 'speech', 'people', 'active-speaker',
                'camera-motion', 'audio', 'quality', 'text', 'duplicates',
              ],
            },
            description: 'Analysis channels to read. Missing channels remain explicitly missing.',
          },
          cursor: {
            type: 'string',
            description: 'Opaque cursor returned by the same query selection.',
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 500,
            description: 'Maximum canonical events; clamped to 1-500 (default 200).',
          },
          maxBytes: {
            type: 'number',
            minimum: 1,
            maximum: 262144,
            description: 'Maximum serialized page bytes; clamped to 256 KiB.',
          },
          includeText: {
            type: 'boolean',
            description: 'Optional. Set true only when transcript and scene-description text should leave the editor for this request. Requires externalDataConsent.',
          },
          externalDataConsent: {
            type: 'string',
            enum: ['share-transcript-and-scene-descriptions'],
            description: 'Required with includeText: explicit permission to share transcript and scene-description strings with the external chat provider for this request.',
          },
        },
        required: ['start', 'end', 'timeDomain', 'channels'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClipAnalysis',
      description: 'Get a compact clip-analysis summary. Detailed frames are omitted by default; request a bounded source-time range with includeFrames, offset, and limit when measurements are needed.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to get analysis for',
          },
          sourceStart: { type: 'number', description: 'Optional source-time range start in seconds' },
          sourceEnd: { type: 'number', description: 'Optional source-time range end in seconds' },
          includeFrames: { type: 'boolean', description: 'Include detailed frame measurements (default false)' },
          offset: { type: 'number', description: 'Frame offset within the matching range (default 0)' },
          limit: { type: 'number', description: 'Maximum detailed frames, 1-200 (default 100)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClipFaceAnalysis',
      description: 'Get confirmed anonymous people, yellow Needs Review tracks, and the queried clip timelineRange. personId accepts either an exact internal ID or a visible label/shorthand such as "Person 6", "person-6", or "6"; personResolution reports the exact resolved ID. Every appearance includes source and timeline ranges. When a person resolves, keepOnlyCutPlan contains ready-to-use complementary removeRanges and a recommended cutRangesFromClip call. Pass those args unchanged; do not split first.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The video clip ID' },
          sourceStart: { type: 'number', description: 'Optional source-time range start in seconds' },
          sourceEnd: { type: 'number', description: 'Optional source-time range end in seconds' },
          personId: { type: 'string', description: 'Optional exact anonymous ID or visible label/shorthand (for example "Person 6", "person-6", or "6"). The tool resolves labels to the analysis-specific internal ID.' },
          includeObservations: { type: 'boolean', description: 'Include sampled boxes and landmarks (default false)' },
          limit: { type: 'number', description: 'Maximum observations, 1-30 (default 20)' },
          reviewLimit: { type: 'number', description: 'Maximum Needs Review tracks, 1-50 (default 30)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mergeClipFacePeople',
      description: 'Merge one confirmed anonymous person group into another. All source appearances become part of the target group and the correction is persisted in the project.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The analyzed video clip ID' },
          sourcePersonId: { type: 'string', description: 'Person ID to merge and remove' },
          targetPersonId: { type: 'string', description: 'Person ID that should receive the source appearances' },
        },
        required: ['clipId', 'sourcePersonId', 'targetPersonId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveClipFaceAppearance',
      description: 'Move one contiguous appearance from a confirmed person group into another person. Use a source timestamp inside the appearance returned by getClipFaceAnalysis.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The analyzed video clip ID' },
          sourcePersonId: { type: 'string', description: 'Current person ID for the appearance' },
          targetPersonId: { type: 'string', description: 'Person ID that should receive the appearance' },
          sourceTime: { type: 'number', description: 'Source-media timestamp inside the appearance to move' },
        },
        required: ['clipId', 'sourcePersonId', 'targetPersonId', 'sourceTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'assignClipFaceReviewCandidate',
      description: 'Assign one yellow Needs Review visual track to a confirmed anonymous person. Use candidateId and targetPersonId returned by getClipFaceAnalysis.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The analyzed video clip ID' },
          candidateId: { type: 'string', description: 'Needs Review candidate ID' },
          targetPersonId: { type: 'string', description: 'Confirmed person ID that should receive the review track' },
        },
        required: ['clipId', 'candidateId', 'targetPersonId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClipTranscript',
      description: 'Get a bounded transcript page with word timestamps and joined text. Use sourceStart/sourceEnd for a time window, then follow nextOffset while hasMore is true.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to get transcript for',
          },
          sourceStart: { type: 'number', description: 'Optional source-time range start in seconds' },
          sourceEnd: { type: 'number', description: 'Optional source-time range end in seconds' },
          offset: { type: 'number', description: 'Word offset within the matching range (default 0)' },
          limit: { type: 'number', description: 'Maximum words, 1-200 (default 120)' },
          includeSegments: { type: 'boolean', description: 'Include word-level segment objects (default true)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSpeechMarkers',
      description: 'Get a bounded page of speech markers such as breaths, fillers, repetitions, false starts, and long pauses, mapped to source and timeline time.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID to inspect' },
          sourceStart: { type: 'number', description: 'Optional source-time range start in seconds' },
          sourceEnd: { type: 'number', description: 'Optional source-time range end in seconds' },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: ['breath', 'filler', 'repetition', 'false-start', 'long-pause'] },
            description: 'Optional marker types to include',
          },
          offset: { type: 'number', minimum: 0, description: 'Marker offset within the matching range (default 0)' },
          limit: { type: 'number', minimum: 1, maximum: 250, description: 'Maximum markers to return (default 100)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findSilentSections',
      description: 'Detect silent sections using voice-activity analysis when available, RMS signal analysis as fallback, and transcript gaps last. Returns the detectionSource used.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to analyze',
          },
          minDuration: {
            type: 'number',
            description: 'Minimum silence duration in seconds to include (default: 0.5)',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findLowQualitySections',
      description: 'Find sections in a clip where focus, motion, or brightness is below a threshold. Useful for finding blurry/unfocused parts to cut.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to analyze',
          },
          metric: {
            type: 'string',
            enum: ['focus', 'motion', 'brightness'],
            description: 'Which metric to check (default: focus)',
          },
          threshold: {
            type: 'number',
            description: 'Threshold value 0-1. Sections BELOW this value are returned. (default: 0.7)',
          },
          minDuration: {
            type: 'number',
            description: 'Minimum section duration in seconds to include (default: 0.5)',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startClipAnalysis',
      description: 'Start video analysis for motion, focus, brightness, and browser-local YuNet + SFace faces. Poll getClipAnalysis for progress or exact errors.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to analyze',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startClipFaceAnalysis',
      description: 'Start browser-local YuNet face detection plus SFace anonymous identity grouping for a video clip. No native helper or cloud upload is used. Poll getClipFaceAnalysis for progress, results, or exact errors.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The video clip ID to analyze' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startClipAudioIntelligence',
      description: 'Start background audio intelligence for voice activity, alignment, speech markers, prosody, and room tone. Poll getSpeechMarkers or findSilentSections for results.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID to analyze' },
          features: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', enum: ['vad', 'alignment', 'speech-markers', 'prosody', 'room-tone'] },
            description: 'Optional subset of audio-intelligence features; all run by default',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'repairClipTranscript',
      description: 'Safely remove duplicated complete transcription runs from a clip source while preserving canonical word IDs, timings, and annotations. Isolated repeated speech is retained.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of a clip whose source transcript should be repaired',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startClipTranscription',
      description: 'Start speech-to-text transcription for a clip. Transcription runs in the background. Check clip details later to see results.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to transcribe',
          },
        },
        required: ['clipId'],
      },
    },
  },
];
