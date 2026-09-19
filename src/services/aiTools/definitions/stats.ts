import type { ToolDefinition } from '../types';

export const statsToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'profileAppInteraction',
      description: 'Measure browser frame gaps and long tasks while the connected dev tab is idle or while a visible canvas is panned in a circle with synthetic middle-pointer input. Dev-bridge debugging only.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['idle', 'circle-pan'], description: 'Idle baseline or circular middle-pointer pan gesture.' },
          selector: { type: 'string', description: 'Visible target selector. Required for circle-pan.' },
          index: { type: 'number', minimum: 0, maximum: 100, description: 'Zero-based target index. Defaults to 0.' },
          durationMs: { type: 'number', minimum: 500, maximum: 10000, description: 'Measurement duration. Defaults to 5000 ms.' },
          radiusPx: { type: 'number', minimum: 4, maximum: 500, description: 'Circle radius in CSS pixels. Defaults to 90.' },
          rotations: { type: 'number', minimum: 0.25, maximum: 20, description: 'Complete rotations during the measurement. Defaults to 5.' },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clickAppControl',
      description: 'Click one visible MasterSelects UI control in the connected dev tab by accessible text or CSS selector, then wait for the resulting UI work to settle. Dev-bridge debugging only.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Accessible label or visible text to match. Required unless a specific selector is supplied.' },
          selector: { type: 'string', description: 'Optional CSS selector. Defaults to visible buttons, links, summaries, and button-like controls.' },
          match: { type: 'string', enum: ['exact', 'contains'], description: 'Text matching mode. Defaults to exact.' },
          index: { type: 'number', minimum: 0, maximum: 100, description: 'Zero-based match index when multiple visible controls match. Defaults to 0.' },
          settleMs: { type: 'number', minimum: 0, maximum: 30000, description: 'Milliseconds to wait after clicking before returning. Defaults to 500.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fillAppControl',
      description: 'Fill one visible MasterSelects input, textarea, or select and dispatch normal input/change events. Dev-bridge debugging only.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Complete replacement value to enter.' },
          selector: { type: 'string', description: 'CSS selector for the target input or textarea.' },
          index: { type: 'number', minimum: 0, maximum: 100, description: 'Zero-based match index. Defaults to 0.' },
          settleMs: { type: 'number', minimum: 0, maximum: 30000, description: 'Milliseconds to wait after filling. Defaults to 250.' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'probeSameOriginRequest',
      description: 'Issue a credentialed same-origin /api/ request from the connected app tab and return status, selected headers, and a bounded redacted response body. Dev-bridge debugging only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Same-origin path beginning with /api/.' },
          method: { type: 'string', enum: ['GET', 'HEAD', 'POST'], description: 'HTTP method. Defaults to GET.' },
          body: { type: 'object', additionalProperties: true, description: 'Optional JSON body for POST requests.' },
          timeoutMs: { type: 'number', minimum: 0, maximum: 60000, description: 'Request timeout in milliseconds. Defaults to 20000.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'captureAppScreenshot',
      description: 'Capture the complete connected MasterSelects page as a PNG for dev-bridge debugging. By default captures the current viewport; fullPage includes the entire scrolling document. Browser chrome and operating-system UI are not included.',
      parameters: {
        type: 'object',
        properties: {
          fullPage: {
            type: 'boolean',
            description: 'Capture the entire scrolling document instead of only the current page viewport. Defaults to false.',
          },
          scale: {
            type: 'number',
            minimum: 0.25,
            maximum: 2,
            description: 'Requested PNG pixel scale. Defaults to 1 and may be reduced automatically to stay within bridge-safe image limits.',
          },
          settleMs: {
            type: 'number',
            minimum: 0,
            maximum: 5000,
            description: 'Optional delay before capture so a recent UI interaction can settle. Defaults to 0.',
          },
        },
        required: [],
      },
    },
  },
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
