import type { ToolDefinition } from '../types';

export const playbackToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'play',
      description: 'Start playback from the current playhead position.',
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
      name: 'pause',
      description: 'Pause playback.',
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
      name: 'reloadApp',
      description: 'Reload the active browser tab after a short delay. Useful for reproducing post-refresh preview issues before the first play.',
      parameters: {
        type: 'object',
        properties: {
          delayMs: {
            type: 'number',
            description: 'Delay before reloading in milliseconds. Defaults to 250.',
          },
          mode: {
            type: 'string',
            enum: ['hard', 'soft'],
            description: 'Use "hard" to navigate with a cache-busting query param, or "soft" for window.location.reload(). Defaults to "hard".',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulateScrub',
      description: 'Simulate a real drag scrub in the browser by holding playhead-drag mode and moving the playhead continuously with requestAnimationFrame. Useful for testing short, long, custom, or wild random scrubbing at different speeds.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            enum: ['short', 'long', 'random', 'custom'],
            description: 'Scrub pattern preset. Use "custom" with points[] for explicit waypoints.',
          },
          speed: {
            type: 'string',
            enum: ['slow', 'normal', 'fast', 'wild'],
            description: 'Drag speed preset. Faster presets shorten each segment between scrub waypoints.',
          },
          durationMs: {
            type: 'number',
            description: 'Total scrub duration in milliseconds. For custom points this is distributed across all segments.',
          },
          segmentMs: {
            type: 'number',
            description: 'Override the per-segment duration in milliseconds for preset patterns.',
          },
          rangeSeconds: {
            type: 'number',
            description: 'For short scrubs, how far to swing around the current playhead position.',
          },
          minTime: {
            type: 'number',
            description: 'Optional lower time bound in seconds.',
          },
          maxTime: {
            type: 'number',
            description: 'Optional upper time bound in seconds.',
          },
          points: {
            type: 'array',
            items: { type: 'number' },
            description: 'Custom scrub waypoints in timeline seconds. Only used when pattern="custom".',
          },
          seed: {
            type: 'number',
            description: 'Optional deterministic seed for random scrubs.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulatePlayback',
      description: 'Run real timeline playback in the browser for a fixed duration, then pause and report how the playhead actually progressed. Useful for reproducing longer playback freezes and checking playback at different speeds.',
      parameters: {
        type: 'object',
        properties: {
          startTime: {
            type: 'number',
            description: 'Optional playback start time in timeline seconds.',
          },
          durationMs: {
            type: 'number',
            description: 'How long to keep playback running before pausing, in milliseconds.',
          },
          playbackSpeed: {
            type: 'number',
            description: 'Optional playback speed for the run, e.g. 1, 2, 0.5, or -1.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional pause-after-run settle time before returning, in milliseconds.',
          },
          resetDiagnostics: {
            type: 'boolean',
            description: 'Whether to reset WebCodecs/VF/health diagnostics before the run. Defaults to true.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulatePlaybackPath',
      description: 'Run a scripted mixed playback-and-scrub stress path in the browser. The default preset starts at the current clip start, plays briefly, scrubs while playback is active to 30s, then to 3m, back to 10s, with play segments between each scrub.',
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            enum: ['play_scrub_stress_v1'],
            description: 'Named scripted playback path preset.',
          },
          startTime: {
            type: 'number',
            description: 'Optional override start time in timeline seconds. Defaults to the active clip start.',
          },
          playbackSpeed: {
            type: 'number',
            description: 'Playback speed for the play segments. Defaults to 1.',
          },
          resetDiagnostics: {
            type: 'boolean',
            description: 'Whether to reset WebCodecs/VF/health diagnostics before the path. Defaults to true.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'setClipSpeed',
      description: 'Set the playback speed of a clip. Also supports reversing.',
      parameters: {
        type: 'object',
        properties: {
          clipId: { type: 'string', description: 'The clip ID' },
          speed: { type: 'number', description: 'Speed multiplier (0.1 = 10% slow-mo, 1 = normal, 2 = 2x fast, etc.)' },
          reverse: { type: 'boolean', description: 'Play the clip in reverse' },
          preservePitch: { type: 'boolean', description: 'Keep original pitch when changing speed (default: true)' },
        },
        required: ['clipId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'undo',
      description: 'Undo the last action.',
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
      name: 'redo',
      description: 'Redo the last undone action.',
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
      name: 'addMarker',
      description: 'Add a marker at a specific time on the timeline.',
      parameters: {
        type: 'object',
        properties: {
          time: { type: 'number', description: 'Time in seconds' },
          label: { type: 'string', description: 'Marker label text' },
          color: { type: 'string', description: 'Marker color (CSS color, e.g. "#ff0000", "red")' },
        },
        required: ['time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMarkers',
      description: 'Get all timeline markers.',
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
      name: 'removeMarker',
      description: 'Remove a timeline marker.',
      parameters: {
        type: 'object',
        properties: {
          markerId: { type: 'string', description: 'The marker ID (from getMarkers)' },
        },
        required: ['markerId'],
      },
    },
  },
];
