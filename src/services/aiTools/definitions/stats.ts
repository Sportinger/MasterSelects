import type { ToolDefinition } from '../types';

export const statsToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getStats',
      description: 'Get current engine/playback stats snapshot for debugging. Returns FPS, timing breakdown, decoder info, drops, playback health, audio status, GPU info.',
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
      name: 'getStatsHistory',
      description: 'Collect multiple stats snapshots over a time window for performance analysis. Returns an array of timestamped samples.',
      parameters: {
        type: 'object',
        properties: {
          samples: { type: 'number', description: 'Number of samples to collect (default: 5, max: 30)' },
          intervalMs: { type: 'number', description: 'Milliseconds between samples (default: 200, min: 100)' },
        },
        required: [],
      },
    },
  },
];
