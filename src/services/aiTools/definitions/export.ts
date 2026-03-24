import type { ToolDefinition } from '../types';

export const exportToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'startExport',
      description: 'Start a video export of the current composition. Returns progress updates and triggers a browser download when complete. The export uses the WebGPU render pipeline, so all effects, transforms, and transitions are included.',
      parameters: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'Output width in pixels (default: composition width)',
          },
          height: {
            type: 'number',
            description: 'Output height in pixels (default: composition height)',
          },
          fps: {
            type: 'number',
            description: 'Frame rate (default: composition frame rate)',
          },
          codec: {
            type: 'string',
            enum: ['h264', 'h265', 'vp9', 'av1'],
            description: 'Video codec (default: h264)',
          },
          container: {
            type: 'string',
            enum: ['mp4', 'webm'],
            description: 'Container format (default: mp4)',
          },
          bitrate: {
            type: 'number',
            description: 'Video bitrate in bps (default: auto-calculated from resolution)',
          },
          startTime: {
            type: 'number',
            description: 'Export start time in seconds (default: 0 or In point)',
          },
          endTime: {
            type: 'number',
            description: 'Export end time in seconds (default: duration or Out point)',
          },
          exportMode: {
            type: 'string',
            enum: ['fast', 'precise'],
            description: 'Export mode: "fast" uses WebCodecs sequential decode, "precise" uses HTMLVideoElement seeking (default: fast)',
          },
          includeAudio: {
            type: 'boolean',
            description: 'Include audio in export (default: true)',
          },
          filename: {
            type: 'string',
            description: 'Output filename without extension (default: "export")',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelExport',
      description: 'Cancel a running export.',
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
      name: 'getExportStatus',
      description: 'Get the current export status (progress, phase, etc.).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
