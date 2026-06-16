import type { ToolDefinition } from '../types';
import { workerFirstShadowRuntimeToolDefinitions } from './workerFirstShadowRuntime';

const workerFirstPlatformEnum = [
  'windows-chromium',
  'linux-chromium-mesa',
  'linux-firefox-mesa',
  'macos-safari',
  'macos-firefox',
] as const;

const workerFirstStrategyEnum = [
  'worker-webgpu-present',
  'worker-webgpu-main-present',
  'worker-cpu-present',
  'main-host-dev',
] as const;

const goldenProjectEnum = [
  'solid-text-image',
  'multi-video',
  'webcodecs-provider',
  'html-provider-fallback',
  'jpeg-proxy',
  'nested-comps',
  'effects-masks-transitions',
  'multi-target-output-slice',
  'ram-cache',
  'bake',
  'export',
  'universal-3d-gaussian-cad',
] as const;

function numberProperty(description: string): Record<string, string> {
  return { type: 'number', description };
}

function booleanProperty(description: string): Record<string, string> {
  return { type: 'boolean', description };
}

function enumProperty(values: readonly string[], description: string): Record<string, unknown> {
  return { type: 'string', enum: values, description };
}

export const workerFirstRuntimeToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstPlatformEvidencePackage',
      description: 'Run the in-browser Worker-First platform proof flow for the current browser/hardware: capability probe, controlled visible stress fixture, visible presentation stress proof, getStats/getPlaybackTrace, and a hashable evidence package. This records one local platform package only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          width: numberProperty('Fixture composition width. Defaults to the fixture runner default.'),
          height: numberProperty('Fixture composition height. Defaults to the fixture runner default.'),
          sampleWidth: numberProperty('Optional fingerprint sample width forwarded to fixture captures.'),
          sampleHeight: numberProperty('Optional fingerprint sample height forwarded to fixture captures.'),
          durationMs: numberProperty('Controlled visible playback stress duration. Defaults to 5000ms and is clamped to 250-9000ms.'),
          minPreviewFrames: numberProperty('Minimum real preview frames required by the visible stress proof. Defaults to that proof runner default.'),
          settleMs: numberProperty('Optional pause-after-run settle time before capture, in milliseconds.'),
          startTime: numberProperty('Optional playback start time in timeline seconds.'),
          playbackSpeed: numberProperty('Optional playback speed for the controlled stress run.'),
          resetDiagnostics: booleanProperty('Whether to reset playback diagnostics before the controlled stress run.'),
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verifyWorkerFirstPlatformEvidenceMatrix',
      description: 'Verify a set of hashable Worker-First platform evidence packages for the required W5 platform matrix. This validates package schema, hashes, visible-stress invariants, stats/trace start-permission guards, duplicates, and missing platforms; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            description: 'Array of package objects returned by runWorkerFirstPlatformEvidencePackage on the target platforms.',
            items: { type: 'object' },
          },
        },
        required: ['packages'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstRuntimeExportPlaybackSmoke',
      description: 'Materialize a controlled worker-first runtime fixture, run real playback simulation, run the browser debug export path, then collect getStats/getPlaybackTrace runtime diagnostics for scheduler/cache/provider feeds. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          width: numberProperty('Fixture composition width. Defaults to 1280.'),
          height: numberProperty('Fixture composition height. Defaults to 720.'),
          durationSeconds: numberProperty('Fixture timeline duration. Defaults to 2.25 seconds.'),
          playbackDurationMs: numberProperty('Playback simulation duration. Defaults to 1000ms.'),
          exportDurationSeconds: numberProperty('Debug export duration from timeline start. Defaults to 0.75 seconds.'),
          exportWidth: numberProperty('Debug export width. Defaults to 320.'),
          exportHeight: numberProperty('Debug export height. Defaults to 180.'),
          exportFps: numberProperty('Debug export frame rate. Defaults to 8.'),
          maxRuntimeMs: numberProperty('Debug export timeout budget. Defaults to 45000ms.'),
        },
        required: [],
      },
    },
  },
  ...workerFirstShadowRuntimeToolDefinitions,
  {
    type: 'function',
    function: {
      name: 'captureWorkerFirstGoldenFixtureFingerprint',
      description: 'Capture and record a W0/W5 golden fixture frame fingerprint from the current main render-host canvas. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          projectId: enumProperty(goldenProjectEnum, 'Golden fixture manifest id. Only materialized manifests can be captured.'),
          sampleTimeSeconds: numberProperty('Manifest sample time in timeline seconds. Must match one of the selected manifest sample times.'),
          sampleWidth: numberProperty('Optional fingerprint sample width. Values are clamped to 1-256.'),
          sampleHeight: numberProperty('Optional fingerprint sample height. Values are clamped to 1-256.'),
          settleMs: numberProperty('Optional milliseconds to wait after seeking before reading the render capture canvas. Values are clamped to 0-5000.'),
        },
        required: ['projectId', 'sampleTimeSeconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'captureWorkerFirstVisiblePresentationProof',
      description: 'Capture and record a W5 DOM-visible presentation proof from the current render capture canvas. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          platform: enumProperty(workerFirstPlatformEnum, 'Required W5 proof platform for the current browser/hardware run.'),
          strategy: enumProperty(workerFirstStrategyEnum, 'Optional assertion for the presentation strategy. If provided, it must match the last render capability probe strategy.'),
          includeFingerprint: booleanProperty('Whether to fingerprint visible pixels. Defaults to true.'),
        },
        required: ['platform'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstVisiblePresentationStressProof',
      description: 'Run controlled browser playback, derive W5 no-stale visible-frame stress evidence from playback diagnostics, and record the current render capture canvas. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          platform: enumProperty(workerFirstPlatformEnum, 'Required W5 proof platform for the current browser/hardware run.'),
          strategy: enumProperty(workerFirstStrategyEnum, 'Optional assertion for the presentation strategy. If provided, it must match the last render capability probe strategy.'),
          startTime: numberProperty('Optional playback start time in timeline seconds.'),
          durationMs: numberProperty('Controlled playback duration in milliseconds. Defaults to 5000.'),
          playbackSpeed: numberProperty('Optional playback speed for the controlled run.'),
          settleMs: numberProperty('Optional pause-after-run settle time before capture, in milliseconds.'),
          captureSettleMs: numberProperty('Optional milliseconds to wait after seeking to the capture time before reading visible pixels. Defaults to settleMs or 750.'),
          minPreviewFrames: numberProperty('Minimum real preview frames required before stress proof is recorded. Defaults to 3.'),
          resetDiagnostics: booleanProperty('Whether to reset playback diagnostics before the controlled run. Defaults to true.'),
        },
        required: ['platform'],
      },
    },
  },
];
