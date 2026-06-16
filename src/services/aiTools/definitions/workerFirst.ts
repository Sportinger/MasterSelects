import type { ToolDefinition } from '../types';

export const workerFirstToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstRenderCapabilityProbe',
      description: 'Run the in-browser worker-first render capability probe and store the latest probe result for W5 proof tools. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
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
      name: 'runWorkerFirstSolidTextImageGoldenFixture',
      description: 'Materialize the W0/W5 solid-text-image golden fixture in the browser timeline and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 1.25 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional per-sample video settle time before fingerprinting. Defaults to 1600ms for this video fixture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstMultiVideoGoldenFixture',
      description: 'Materialize the W0/W5 multi-video golden fixture from bundled project videos and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Minimum fixture timeline duration. Defaults to 6 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstWebCodecsProviderGoldenFixture',
      description: 'Materialize the W0/W5 webcodecs-provider golden fixture with a full-mode WebCodecs video runtime source and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Minimum fixture timeline duration. Defaults to 2.25 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional per-sample video settle time before fingerprinting. Defaults to 1500ms for this WebCodecs fixture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstHtmlProviderGoldenFixture',
      description: 'Materialize the W0/W5 html-provider-fallback golden fixture with an explicit HTML video runtime source and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Minimum fixture timeline duration. Defaults to 3 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional per-sample video settle time before fingerprinting. Defaults to 1200ms for this video fixture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstJpegProxyGoldenFixture',
      description: 'Materialize the W0/W5 jpeg-proxy golden fixture with controlled JPEG proxy cache source substitution and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Minimum fixture timeline duration. Defaults to 3 seconds and must cover the manifest sample times.',
          },
          proxyFps: {
            type: 'number',
            description: 'Synthetic JPEG proxy frame rate for seeded diagnostic proxy frames. Defaults to 24.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional per-sample video settle time before fingerprinting. Defaults to 1200ms for this proxy fixture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstEffectsMasksTransitionsGoldenFixture',
      description: 'Materialize the W0/W5 effects-masks-transitions golden fixture with controlled effects, masks, transition, and blend mode, then capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 2 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas. Defaults to 500ms for this static fixture.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstMultiTargetOutputSliceGoldenFixture',
      description: 'Materialize the W0/W5 multi-target-output-slice golden fixture with controlled active composition preview targets and output slice routing, then capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the content fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline and output routing state after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 3.25 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstNestedCompsGoldenFixture',
      description: 'Materialize the W0/W5 nested-comps golden fixture with reusable nested composition clips and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 3.25 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstRamCacheGoldenFixture',
      description: 'Materialize the W0/W5 ram-cache golden fixture, generate RAM preview composite cache frames through the existing RAM preview path, and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the content fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 1.35 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstBakeGoldenFixture',
      description: 'Materialize the W0/W5 bake golden fixture, run the existing clip-bake and composition-bake product paths, and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the content fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstExportGoldenFixture',
      description: 'Materialize the W0/W5 export golden fixture, run the existing debugExport/FrameExporter preview-parity product path, and capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the content fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to export parity and each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to export parity and each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstUniversal3dGoldenFixture',
      description: 'Materialize the W0/W5 universal 3D/Gaussian/CAD golden fixture from existing mesh, signal-asset, and renderer-adapter descriptor paths, then capture every manifest sample through the main-renderer golden fingerprint bridge. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          resetProject: {
            type: 'boolean',
            description: 'Whether to reset the current project before materializing the content fixture. Defaults to true.',
          },
          restoreTimelineAfterRun: {
            type: 'boolean',
            description: 'Whether to restore the previous timeline after capturing. Defaults to false so follow-up proof tools can run on the fixture.',
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
            description: 'Fixture timeline duration. Defaults to 2.35 seconds and must cover the manifest sample times.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to each manifest capture.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to each manifest capture.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional milliseconds to wait after seeking before reading the render capture canvas.',
          },
        },
      required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runWorkerFirstW5EvidenceSuite',
      description: 'Run the accepted W5 evidence suite in one fresh browser proof session: clear volatile proof captures, execute every W0/W5 golden fixture runner, execute the controlled worker-shadow parity runners, derive the current proof platform from a browser capability probe, re-materialize an extended solid/text/image fixture as a nonblank visible stress surface, run local visible-presentation stress proof unless disabled, and return an accepted gate snapshot. This records observation data only; it does not enable worker WebGPU, worker presentation, or RenderDispatcher cutover.',
      parameters: {
        type: 'object',
        properties: {
          width: {
            type: 'number',
            description: 'Optional fixture composition width forwarded to controlled runners. Defaults stay runner-specific when omitted.',
          },
          height: {
            type: 'number',
            description: 'Optional fixture composition height forwarded to controlled runners. Defaults stay runner-specific when omitted.',
          },
          sampleWidth: {
            type: 'number',
            description: 'Optional fingerprint sample width forwarded to controlled runners.',
          },
          sampleHeight: {
            type: 'number',
            description: 'Optional fingerprint sample height forwarded to controlled runners.',
          },
          settleMs: {
            type: 'number',
            description: 'Optional per-sample settle time forwarded to controlled runners and the visible stress proof when supported.',
          },
          includeVisiblePresentationProofs: {
            type: 'boolean',
            description: 'Whether to run the local capability-probe plus visible-presentation stress proof after the fixture/shadow runners. Defaults to true.',
          },
          clearBeforeRun: {
            type: 'boolean',
            description: 'Whether to clear volatile proof captures and counter sources before this suite call. Defaults to true; set false when collecting runnerIds in controlled phases.',
          },
          runnerIds: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'solid-text-image-golden',
                'multi-video-golden',
                'multi-video-worker-shadow',
                'webcodecs-provider-golden',
                'webcodecs-provider-worker-shadow',
                'html-provider-fallback-golden',
                'html-provider-fallback-worker-shadow',
                'jpeg-proxy-golden',
                'jpeg-proxy-worker-shadow',
                'nested-comps-golden',
                'nested-comps-worker-shadow',
                'effects-masks-transitions-golden',
                'effects-masks-transitions-worker-shadow',
                'multi-target-output-slice-golden',
                'multi-target-output-slice-worker-shadow',
                'ram-cache-golden',
                'ram-cache-worker-shadow',
                'bake-golden',
                'bake-worker-shadow',
                'export-golden',
                'export-worker-shadow',
                'universal-3d-gaussian-cad-golden',
                'universal-3d-gaussian-cad-worker-shadow',
                'solid-text-image-worker-shadow',
              ],
            },
            description: 'Optional exact controlled runner ids to execute in this call. Use with clearBeforeRun=false to collect the accepted suite over multiple bridge calls without accepting caller-supplied evidence.',
          },
          durationMs: {
            type: 'number',
            description: 'Optional playback duration for the local visible-presentation stress proof. Defaults to that proof runner.',
          },
          minPreviewFrames: {
            type: 'number',
            description: 'Optional minimum preview frame count required by the local visible-presentation stress proof.',
          },
          startTime: {
            type: 'number',
            description: 'Optional playback start time for the local visible-presentation stress proof.',
          },
          playbackSpeed: {
            type: 'number',
            description: 'Optional playback speed for the local visible-presentation stress proof.',
          },
        },
        required: [],
      },
    },
  },
];
