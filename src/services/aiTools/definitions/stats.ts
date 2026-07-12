import type { ToolDefinition } from '../types';

export const statsToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getCaptureState',
      description: 'Get the serializable screen-capture session, encoder/muxer pressure, audio levels, and persisted recovery summary.',
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
      name: 'getStats',
      description: 'Get current engine/playback stats snapshot for debugging. Returns FPS, timing breakdown, decoder info, drops, playback health, cache/budget stats, freeze/path counters, audio status, and GPU info.',
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
  {
    type: 'function',
    function: {
      name: 'getAudioDiagnostics',
      description: 'Get focused live audio playback diagnostics for crackle/dropout debugging. Returns media element ready/buffer state, audio drift/correction events, Web Audio context latency/state, routing graph state, and recent audio events.',
      parameters: {
        type: 'object',
        properties: {
          windowMs: { type: 'number', description: 'Recent audio event window in milliseconds (default: 5000, max: 120000)' },
          eventLimit: { type: 'number', description: 'Maximum recent audio events to include (default: 50, max: 500)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getLogs',
      description: 'Get recent buffered browser logs for debugging. Supports filtering by level, module name, and search text.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of recent log entries to return (default: 100, max: 500)' },
          level: { type: 'string', description: 'Minimum log level filter: DEBUG, INFO, WARN, ERROR' },
          module: { type: 'string', description: 'Substring filter for the logger module name, e.g. PlaybackHealth or CutTransition' },
          search: { type: 'string', description: 'Substring filter against the message and serialized data' },
          sinceIso: { type: 'string', description: 'Only return log entries with timestamp greater than or equal to this ISO timestamp' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPlaybackTrace',
      description: 'Get recent playback pipeline events plus derived playback summary, health state, cache/budget stats, and freeze/path counters for debugging WebCodecs/VF/HTML playback issues.',
      parameters: {
        type: 'object',
        properties: {
          windowMs: { type: 'number', description: 'Time window in milliseconds to inspect (default: 5000, max: 120000)' },
          limit: { type: 'number', description: 'Maximum number of recent WC/VF events to include (default: 200, max: 2000)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRuntimeDiagnostics',
      description: 'Get browser runtime diagnostics captured inside the app for bridge-only automation: console entries, window errors, unhandled promise rejections, WebGPU uncaptured errors, and device-lost events.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of recent entries to return (default: 100, max: 1000)' },
          level: { type: 'string', description: 'Minimum diagnostic level filter: DEBUG, INFO, WARN, ERROR' },
          source: { type: 'string', description: 'Exact source filter, e.g. console, window-error, unhandledrejection, webgpu-uncapturederror, webgpu-device-lost' },
          search: { type: 'string', description: 'Substring filter against source, message, arguments, stack, and details' },
          sinceId: { type: 'number', description: 'Only return entries with an id greater than this value' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clearRuntimeDiagnostics',
      description: 'Clear the browser runtime diagnostics buffer before a deterministic bridge-driven test run.',
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
      name: 'purgePlaybackPath',
      description: 'Reset the live playback path at the current playhead without reloading the app. Clears VideoSync warmups/seeks, retargets active video/WebCodecs providers, resets GPU-ready state, and optionally resumes playback.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['targeted', 'full'],
            description: 'targeted resets active playback clips; full also clears broader preview caches. Defaults to targeted.',
          },
          resumePlayback: {
            type: 'boolean',
            description: 'Whether to resume playback after the purge. Defaults to the pre-purge playing state.',
          },
          reason: {
            type: 'string',
            description: 'Short diagnostic reason included in logs and tool result.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'samplePlaybackFramePacing',
      description: 'Measure high-resolution browser frame pacing during playback/debug runs. Samples requestAnimationFrame gaps, timeline store playhead deltas, live timeline playhead DOM motion, render-loop count changes, and long tasks.',
      parameters: {
        type: 'object',
        properties: {
          durationMs: { type: 'number', description: 'Sampling duration in milliseconds (default: 10000, min: 500, max: 30000)' },
          startPlayback: { type: 'boolean', description: 'Start playback for the sample if it is not already playing. Defaults to false.' },
          startTime: { type: 'number', description: 'Optional playhead time in seconds to seek to before sampling.' },
          leavePlaying: { type: 'boolean', description: 'Keep playback running after sampling when this tool started it. Defaults to false.' },
          includeSamples: { type: 'boolean', description: 'Include raw trailing frame samples in the result. Defaults to false.' },
          sampleLimit: { type: 'number', description: 'Maximum trailing samples to include when includeSamples is true (default: 240, max: 2000).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setRenderHostMode',
      description: 'Set the dev/test render host mode for worker-first playback validation. Use worker-presenting for the worker preview path, worker-only to disable the normal main-thread fallback, worker-gpu-only to force strict Worker WebGPU presentation, worker-shadow for shadow-only checks, main for the explicit legacy fallback, and default to clear the persisted override.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['main', 'worker-shadow', 'worker-presenting', 'worker-only', 'worker-gpu-only', 'default'],
            description: 'Render host mode to persist and apply immediately.',
          },
        },
        required: ['mode'],
      },
    },
  },
];
