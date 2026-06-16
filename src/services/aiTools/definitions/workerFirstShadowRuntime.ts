import type { ToolDefinition } from '../types';

interface WorkerFirstShadowToolConfig {
  readonly name: string;
  readonly fixtureLabel: string;
  readonly captureLabel: string;
  readonly durationDescription: string;
  readonly includeSettleMs?: boolean;
}

function baseShadowProperties(config: WorkerFirstShadowToolConfig): Record<string, unknown> {
  return {
    resetProject: {
      type: 'boolean',
      description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
    },
    width: {
      type: 'number',
      description: 'Fixture composition width. Defaults to 1280.',
    },
    height: {
      type: 'number',
      description: 'Fixture composition height. Defaults to 720.',
    },
    durationSeconds: {
      type: 'number',
      description: config.durationDescription,
    },
    sampleWidth: {
      type: 'number',
      description: 'Optional fingerprint sample width forwarded to main and worker-shadow captures.',
    },
    sampleHeight: {
      type: 'number',
      description: 'Optional fingerprint sample height forwarded to main and worker-shadow captures.',
    },
    ...(config.includeSettleMs
      ? {
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the main render capture canvas.',
          },
        }
      : {}),
  };
}

function shadowToolDefinition(config: WorkerFirstShadowToolConfig): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: config.name,
      description: `Materialize the W0/W5 ${config.fixtureLabel} fixture, capture main-renderer ${config.captureLabel}, render a data-only worker-shadow version in an OffscreenCanvas worker, and record parity samples. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.`,
      parameters: {
        type: 'object',
        properties: baseShadowProperties(config),
        required: [],
      },
    },
  };
}

export const workerFirstShadowRuntimeToolDefinitions: ToolDefinition[] = [
  shadowToolDefinition({
    name: 'runWorkerFirstSolidTextImageShadowParity',
    fixtureLabel: 'solid-text-image',
    captureLabel: 'fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 1.25 seconds and must cover the manifest sample times.',
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstMultiVideoShadowParity',
    fixtureLabel: 'multi-video',
    captureLabel: 'video fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 6 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstWebCodecsProviderShadowParity',
    fixtureLabel: 'webcodecs-provider',
    captureLabel: 'WebCodecs provider fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 2.25 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstHtmlProviderShadowParity',
    fixtureLabel: 'html-provider-fallback',
    captureLabel: 'HTML-video provider fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 3 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstMultiTargetOutputSliceShadowParity',
    fixtureLabel: 'multi-target-output-slice',
    captureLabel: 'fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 3.25 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstJpegProxyShadowParity',
    fixtureLabel: 'jpeg-proxy',
    captureLabel: 'fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 3 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstNestedCompsShadowParity',
    fixtureLabel: 'nested-comps',
    captureLabel: 'fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 3.25 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstEffectsMasksTransitionsShadowParity',
    fixtureLabel: 'effects-masks-transitions',
    captureLabel: 'fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 2 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstRamCacheShadowParity',
    fixtureLabel: 'ram-cache',
    captureLabel: 'composite-cache fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 1.35 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstBakeShadowParity',
    fixtureLabel: 'bake',
    captureLabel: 'clip/composition bake fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstExportShadowParity',
    fixtureLabel: 'export',
    captureLabel: 'export fingerprints through the controlled export golden runner',
    durationDescription: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
  }),
  shadowToolDefinition({
    name: 'runWorkerFirstUniversal3dShadowParity',
    fixtureLabel: 'universal 3D/Gaussian/CAD',
    captureLabel: 'descriptor fingerprints',
    durationDescription: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
    includeSettleMs: true,
  }),
];
