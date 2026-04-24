// Media Panel Tool Definitions

import type { ToolDefinition } from '../types';

export const mediaToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getMediaItems',
      description: 'Get all items in the media panel: files (video, audio, image), compositions, and folders. Useful for understanding project structure.',
      parameters: {
        type: 'object',
        properties: {
          folderId: {
            type: 'string',
            description: 'Get items in a specific folder. Omit or null for root level items.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createMediaFolder',
      description: 'Create a new folder in the media panel for organizing files.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the new folder',
          },
          parentFolderId: {
            type: 'string',
            description: 'ID of parent folder (omit for root level)',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'renameMediaItem',
      description: 'Rename a media item (file, folder, or composition).',
      parameters: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string',
            description: 'ID of the item to rename',
          },
          newName: {
            type: 'string',
            description: 'New name for the item',
          },
        },
        required: ['itemId', 'newName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deleteMediaItem',
      description: 'Delete a media item (file, folder, or composition). Warning: Folders delete all contents.',
      parameters: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string',
            description: 'ID of the item to delete',
          },
        },
        required: ['itemId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'moveMediaItems',
      description: 'Move media items to a different folder.',
      parameters: {
        type: 'object',
        properties: {
          itemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of item IDs to move',
          },
          targetFolderId: {
            type: 'string',
            description: 'ID of target folder (omit or null to move to root)',
          },
        },
        required: ['itemIds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createComposition',
      description: 'Create a new composition (timeline sequence). By default opens it immediately so subsequent operations target it.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the composition',
          },
          width: {
            type: 'number',
            description: 'Width in pixels (default: 1920)',
          },
          height: {
            type: 'number',
            description: 'Height in pixels (default: 1080)',
          },
          frameRate: {
            type: 'number',
            description: 'Frame rate (default: 30)',
          },
          duration: {
            type: 'number',
            description: 'Duration in seconds (default: 60)',
          },
          openAfterCreate: {
            type: 'boolean',
            description: 'Open the composition immediately after creation (default: true). Set to false to create without switching.',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'openComposition',
      description: 'Open a composition in the timeline and make it the active composition. Use getMediaItems first to find composition IDs.',
      parameters: {
        type: 'object',
        properties: {
          compositionId: {
            type: 'string',
            description: 'ID of the composition to open',
          },
        },
        required: ['compositionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'importLocalFiles',
      description: 'Import supported local files from disk into the media panel. Provide absolute file paths. Uses the dev bridge in development or the Native Helper in production. Supports video, audio, image, 3D model, and gaussian-splat files that the editor already knows how to import. Can optionally place them on the timeline with full control over track and position.',
      parameters: {
        type: 'object',
        properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of absolute file paths to import (e.g. ["C:/Users/admin/Downloads/video.mp4", "C:/Users/admin/Downloads/cloud.ply"]). Use forward slashes.',
            },
          addToTimeline: {
            type: 'boolean',
            description: 'If true, also add imported files as clips to the timeline (default: false)',
          },
          trackId: {
            type: 'string',
            description: 'ID of the track to place clips on. Use getTimelineState to find track IDs. If omitted, uses the first video/audio track.',
          },
          createTrack: {
            type: 'boolean',
            description: 'If true, create a new track for these clips instead of using an existing one (default: false)',
          },
          trackType: {
            type: 'string',
            enum: ['video', 'audio'],
            description: 'Type of track to create when createTrack is true (default: "video")',
          },
          startTime: {
            type: 'number',
            description: 'Timeline position (in seconds) where the first clip should be placed. If omitted, appends after the last clip on the track.',
          },
          sequential: {
            type: 'boolean',
            description: 'If true (default), place clips one after another. If false, stack all clips at the same startTime (for layering).',
          },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listLocalFiles',
      description: 'List supported import files in a local directory. Returns file names, paths, sizes and modification dates. Uses the dev bridge in development or the Native Helper in production.',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Absolute path to directory (e.g. "C:/Users/admin/Downloads"). Use forward slashes.',
          },
          extensions: {
            type: 'string',
            description: 'Comma-separated file extensions to filter (e.g. ".mp4,.webm,.mov,.obj,.ply,.splat,.spz"). Default: all currently supported import extensions.',
          },
        },
        required: ['directory'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'selectMediaItems',
      description: 'Select items in the media panel.',
      parameters: {
        type: 'object',
        properties: {
          itemIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of item IDs to select',
          },
        },
        required: ['itemIds'],
      },
    },
  },
];
