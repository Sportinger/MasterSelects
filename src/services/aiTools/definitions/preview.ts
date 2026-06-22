// Preview & Frame Capture Tool Definitions

import type { ToolDefinition } from '../types';

export const previewToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'captureFrame',
      description: 'Capture the current composition output as a still image (screenshot). Returns a base64-encoded PNG.',
      parameters: {
        type: 'object',
        properties: {
          time: {
            type: 'number',
            description: 'Time in seconds to capture (optional, uses current playhead if not specified)',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'gpu', 'dom'],
            description: 'Capture mode. auto tries GPU readback first and falls back to the visible preview canvas (default: auto).',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCutPreviewQuad',
      description: 'Get an 8-frame preview image showing frames around a cut point: 4 frames BEFORE and 4 frames AFTER. Returns a 4x2 grid image (top row: before, bottom row: after). Use this to evaluate if a cut will look smooth or jarring.',
      parameters: {
        type: 'object',
        properties: {
          cutTime: {
            type: 'number',
            description: 'The timeline time (in seconds) where the cut will happen',
          },
          frameSpacing: {
            type: 'number',
            description: 'Seconds between each frame (default: 0.1 = 100ms). Smaller = closer to cut point.',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'gpu', 'dom'],
            description: 'Capture mode. auto tries GPU readback first and falls back to the visible preview canvas (default: auto).',
          },
        },
        required: ['cutTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFramesAtTimes',
      description: 'Capture frames at specific timeline times and return as a grid image. Useful for comparing different moments or evaluating transitions.',
      parameters: {
        type: 'object',
        properties: {
          times: {
            type: 'array',
            items: { type: 'number' },
            description: 'Array of timeline times (in seconds) to capture frames at. Max 8 frames.',
          },
          columns: {
            type: 'number',
            description: 'Number of columns in the grid (default: 4)',
          },
          settleMs: {
            type: 'number',
            description: 'Milliseconds to wait after each seek before reading pixels (default: 140)',
          },
          mode: {
            type: 'string',
            enum: ['auto', 'gpu', 'dom'],
            description: 'Capture mode. auto tries GPU readback first and falls back to the visible preview canvas (default: auto).',
          },
        },
        required: ['times'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runPixelParticleDisintegrateQa',
      description: 'Dev-bridge QA runner for pixel-particle-disintegrate. Creates a temporary synthetic image clip, applies the particle effect with progress keyframes, captures progress 0/0.5/1 frames, runs a short debug export across the fade, fingerprints preview/export frames, then restores the previous timeline by default.',
      parameters: {
        type: 'object',
        properties: {
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after the QA run. Defaults to true.',
          },
          captureMode: {
            type: 'string',
            enum: ['auto', 'gpu', 'dom'],
            description: 'Capture mode for preview frames. Defaults to dom so QA compares the visible presented preview against export preview.',
          },
          sampleSize: {
            type: 'number',
            description: 'Fingerprint sample grid size. Defaults to 20 and clamps to 4..64.',
          },
          includePlaybackParity: {
            type: 'boolean',
            description: 'Whether to compare a paused playback frame with a direct seek to the same time. Defaults to true.',
          },
          durationSeconds: {
            type: 'number',
            description: 'Temporary QA clip/timeline duration. Defaults to 1.25.',
          },
          exportMode: {
            type: 'string',
            enum: ['fast', 'precise'],
            description: 'Debug export mode. Defaults to fast.',
          },
          exportWidth: {
            type: 'number',
            description: 'Debug export width. Defaults to 320.',
          },
          exportHeight: {
            type: 'number',
            description: 'Debug export height. Defaults to 180.',
          },
          exportFps: {
            type: 'number',
            description: 'Debug export FPS. Defaults to 8.',
          },
          maxRuntimeMs: {
            type: 'number',
            description: 'Debug export timeout budget. Defaults to 45000ms.',
          },
        },
        required: [],
      },
    },
  },
];
