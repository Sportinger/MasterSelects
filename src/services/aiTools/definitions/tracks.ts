// Track Tool Definitions

import type { ToolDefinition } from '../types';

export const trackToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'createTrack',
      description: 'Create a new video or audio track.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['video', 'audio'],
            description: 'Type of track to create',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteTrack',
      description: 'Delete a track and all clips on it.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'The ID of the track to delete',
          },
        },
        required: ['trackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setTrackVisibility',
      description: 'Show or hide a video track.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'The ID of the track',
          },
          visible: {
            type: 'boolean',
            description: 'Whether the track should be visible',
          },
        },
        required: ['trackId', 'visible'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setTrackMuted',
      description: 'Mute or unmute an audio track.',
      parameters: {
        type: 'object',
        properties: {
          trackId: {
            type: 'string',
            description: 'The ID of the track',
          },
          muted: {
            type: 'boolean',
            description: 'Whether the track should be muted',
          },
        },
        required: ['trackId', 'muted'],
      },
    },
  },
];
