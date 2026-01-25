// Analysis & Transcript Tool Definitions

import type { ToolDefinition } from '../types';

export const analysisToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getClipAnalysis',
      description: 'Get the analysis data for a clip (motion, faces, colors, etc.). Returns null if not analyzed.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to get analysis for',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getClipTranscript',
      description: 'Get the transcript/subtitles for a clip with word-level timestamps. Returns null if no transcript.',
      parameters: {
        type: 'object',
        properties: {
          clipId: {
            type: 'string',
            description: 'The ID of the clip to get transcript for',
          },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findSilentSections',
      description: 'Find sections in a clip where there is no speech (based on transcript). Useful for finding pauses to cut.',
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
      description: 'Start video analysis (motion, focus, brightness) for a clip. Analysis runs in the background. Check clip details later to see results.',
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
