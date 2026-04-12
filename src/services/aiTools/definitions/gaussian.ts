import type { ToolDefinition } from '../types';

export const gaussianToolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getGaussianStatus',
      description: 'Get full status of the Gaussian Splat Avatar system: renderer state, module loaded, avatar loaded, canvas dimensions, WebGL context, blendshapes, container presence, and any errors.',
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
      name: 'getGaussianLayers',
      description: 'Get all gaussian-avatar layers currently in the render pipeline. Shows layer data, clip source, blob URLs, blendshapes, and whether they are being processed by RenderDispatcher.',
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
      name: 'getGaussianClips',
      description: 'Get all gaussian-avatar clips on the timeline with their full state: source data, blob URLs, is3D flag, isLoading, mediaFileId, and linked media file info.',
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
      name: 'testGaussianRenderer',
      description: 'End-to-end test of the Gaussian Splat renderer: initializes the module, attempts to load the bundled test avatar (avatar_desktop_arkit.zip), checks canvas output, and reports each step\'s success/failure with timing.',
      parameters: {
        type: 'object',
        properties: {
          avatarUrl: {
            type: 'string',
            description: 'URL to the avatar .zip file. Defaults to /gaussian-splat/avatar_desktop_arkit.zip',
          },
          timeoutMs: {
            type: 'number',
            description: 'Max time to wait for avatar load in ms (default: 15000)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'testGaussianModule',
      description: 'Test just the module loading step: fetch the renderer JS from public/, create blob URL, dynamic import, and check what exports are available. Diagnoses Vite/import issues.',
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
      name: 'testGaussianImportPipeline',
      description: 'Test the full import-to-timeline pipeline: create a fake File from the bundled avatar zip, run importGaussianAvatar, add clip to timeline, and verify the layer builder produces a gaussian-avatar layer. Reports each step.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
];
