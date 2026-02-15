// YouTube AI Tool Definitions

import type { ToolDefinition } from '../types';

export const youtubeToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'searchVideos',
      description: 'Search for videos by keyword using yt-dlp (no API key needed). Returns video results with title, channel, duration, views, and URL. Results also appear in the Downloads panel. Each result has a url ready for downloadAndImportVideo. Requires the Native Helper to be running.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (1-20, default 5)',
          },
          maxDuration: {
            type: 'number',
            description: 'Filter: maximum duration in seconds (e.g. 60 for videos under 1 minute)',
          },
          minDuration: {
            type: 'number',
            description: 'Filter: minimum duration in seconds',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listVideoFormats',
      description: 'List available download formats and qualities for a video URL. Works with YouTube, TikTok, Instagram, Twitter/X, Vimeo, and other platforms supported by yt-dlp. Returns recommended formats and detailed format information. Requires the Native Helper to be running.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Video URL (YouTube, TikTok, Instagram, etc.) or YouTube video ID',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'downloadAndImportVideo',
      description: 'Download a video and import it directly into the timeline. Creates a pending clip that shows download progress, then converts to a real playable clip when done. By default places the clip at position 0 on an empty timeline, or after the last clip. Use compositionId to import into a specific composition (otherwise imports into the currently active one). Requires the Native Helper to be running.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Video URL (YouTube, TikTok, Instagram, etc.)',
          },
          title: {
            type: 'string',
            description: 'Title for the clip on the timeline',
          },
          formatId: {
            type: 'string',
            description: 'Format ID from listVideoFormats (optional, uses best quality if not specified)',
          },
          thumbnail: {
            type: 'string',
            description: 'Thumbnail URL for the pending clip (optional)',
          },
          compositionId: {
            type: 'string',
            description: 'Target composition ID to import into. If omitted, imports into the currently active composition. Use createComposition + this parameter to import into a new composition.',
          },
          startTime: {
            type: 'number',
            description: 'Start time in seconds where to place the clip on the timeline. Default: 0 for empty timelines, after last clip otherwise.',
          },
        },
        required: ['url', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getYouTubeVideos',
      description: 'Get the list of videos currently in the Downloads panel (from previous searches or pasted URLs).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
