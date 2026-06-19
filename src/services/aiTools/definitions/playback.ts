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
          resetDiagnostics: {
            type: 'boolean',
            description: 'Reset playback diagnostics before the scrub run. Defaults to true.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulateFrameKeypresses',
      description: 'Dispatch real ArrowLeft/ArrowRight KeyboardEvent keydown events in the browser so timeline frame stepping goes through the same global shortcut handler as physical keyboard input.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['left', 'right', 'both'],
            description: 'Direction preset. Defaults to "both", which sends leftCount ArrowLeft events then rightCount ArrowRight events.',
          },
          count: {
            type: 'number',
            description: 'Number of events when direction is "left" or "right". Defaults to 1.',
          },
          leftCount: {
            type: 'number',
            description: 'Number of ArrowLeft events for direction="both". Defaults to 6.',
          },
          rightCount: {
            type: 'number',
            description: 'Number of ArrowRight events for direction="both". Defaults to 6.',
          },
          sequence: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['ArrowLeft', 'ArrowRight', 'left', 'right'],
            },
            description: 'Optional explicit key sequence. Overrides direction/count parameters.',
          },
          startTime: {
            type: 'number',
            description: 'Optional timeline start time in seconds before dispatching key events.',
          },
          delayMs: {
            type: 'number',
            description: 'Wait time after each dispatched keydown before sampling playhead/render diagnostics. Defaults to 120ms.',
          },
          settleMs: {
            type: 'number',
            description: 'Final wait time before returning diagnostics. Defaults to 150ms.',
          },
          pauseBefore: {
            type: 'boolean',
            description: 'Pause playback before dispatching frame-step keys. Defaults to true.',
          },
          target: {
            type: 'string',
            enum: ['activeElement', 'body', 'window'],
            description: 'DOM target to dispatch the keydown events on. Defaults to activeElement, matching physical key target routing most closely.',
          },
          resetDiagnostics: {
            type: 'boolean',
            description: 'Reset WebCodecs/VF/health diagnostics before dispatching key events. Defaults to true.',
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
          restorePlaybackState: {
            type: 'boolean',
            description: 'Restore playback if it was already running before the simulation. Defaults to false so diagnostics runs leave playback paused.',
          },
          sampleVisibleFrames: {
            type: 'boolean',
            description: 'Whether to sample visible preview canvas fingerprints during playback. Defaults to false.',
          },
          visibleSampleIntervalMs: {
            type: 'number',
            description: 'Interval for visible preview canvas fingerprint sampling when enabled. Defaults to 100ms.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'simulatePlaybackPulses',
      description: 'Run repeated play/pause pulses fully inside the browser and report start latency, RAF cadence, playhead movement, and worker GPU video timestamp drift.',
      parameters: {
        type: 'object',
        properties: {
          startTime: {
            type: 'number',
            description: 'Optional playback start time in timeline seconds.',
          },
          cycles: {
            type: 'number',
            description: 'Number of play/pause cycles. Defaults to 10.',
          },
          firstPlayMs: {
            type: 'number',
            description: 'Play duration for the first cycle in milliseconds. Defaults to 1000.',
          },
          playMs: {
            type: 'number',
            description: 'Play duration for subsequent cycles in milliseconds. Defaults to 500.',
          },
          pauseMs: {
            type: 'number',
            description: 'Pause duration between cycles in milliseconds. Defaults to 500.',
          },
          initialPauseMs: {
            type: 'number',
            description: 'Settled pause duration after optional startTime before the first play. Defaults to 500.',
          },
          playbackSpeed: {
            type: 'number',
            description: 'Playback speed for all play pulses. Defaults to 1.',
          },
          resetDiagnostics: {
            type: 'boolean',
            description: 'Whether to reset WebCodecs/VF/health diagnostics before the pulse run. Defaults to true.',
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
