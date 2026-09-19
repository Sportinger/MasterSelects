import type { ToolDefinition } from '../aiTools';

const generationRequestProperties: Record<string, unknown> = {
  aspectRatio: {
    description: 'Aspect ratio returned by inspectMediaGenerationModel.',
    type: 'string',
  },
  duration: {
    description: 'Video duration returned by inspectMediaGenerationModel.',
    type: 'number',
  },
  endMediaFileId: {
    description: 'Optional Media-panel image id to use as the exact end frame.',
    type: 'string',
  },
  generateAudio: {
    description: 'Whether a compatible video model should generate audio.',
    type: 'boolean',
  },
  idempotencyKey: {
    description: 'Stable unique key beginning with kernel-media-generation: for safe retries.',
    maxLength: 240,
    pattern: '^kernel-media-generation:[A-Za-z0-9._:-]+$',
    type: 'string',
  },
  imageSize: {
    description: 'Image size returned by inspectMediaGenerationModel.',
    type: 'string',
  },
  mode: {
    description: 'Generation mode returned by inspectMediaGenerationModel.',
    type: 'string',
  },
  multiPrompt: {
    description: 'Optional ordered multi-shot prompts for a compatible video model.',
    items: {
      additionalProperties: false,
      properties: {
        duration: { exclusiveMinimum: 0, type: 'number' },
        index: { minimum: 1, type: 'integer' },
        prompt: { maxLength: 2_000, minLength: 1, type: 'string' },
      },
      required: ['index', 'prompt', 'duration'],
      type: 'object',
    },
    maxItems: 6,
    minItems: 1,
    type: 'array',
  },
  multiShots: {
    description: 'Whether a compatible video model should use multi-shot generation.',
    type: 'boolean',
  },
  negativePrompt: { maxLength: 50_000, type: 'string' },
  outputType: {
    description: 'The type of media to generate.',
    enum: ['image', 'video'],
    type: 'string',
  },
  prompt: {
    description: 'The actual image or video generation prompt.',
    maxLength: 50_000,
    type: 'string',
  },
  providerId: {
    description: 'Optional provider id returned by inspectMediaGenerationModel.',
    type: 'string',
  },
  referenceMediaFileIds: {
    description: 'Optional Media-panel ids to use as model references.',
    items: { type: 'string' },
    type: 'array',
    uniqueItems: true,
  },
  settingsToken: {
    description: 'Opaque token returned by inspectMediaGenerationModel. Pass it unchanged.',
    minLength: 1,
    type: 'string',
  },
  startMediaFileId: {
    description: 'Optional Media-panel image id to use as the exact start frame.',
    type: 'string',
  },
  version: {
    description: 'Model version returned by inspectMediaGenerationModel.',
    type: 'string',
  },
};

export const DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'inspectMediaGenerationModel',
      description: 'Inspect a real MasterSelects image or video generator. Returns available models, allowed settings, defaults, and the settingsToken required by startMediaGeneration.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outputType: { enum: ['image', 'video'], type: 'string' },
          providerId: { description: 'Optional provider id. Omit to use the default model.', type: 'string' },
        },
        required: ['outputType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'previewMediaGeneration',
      description: 'Optional dry run that validates and summarizes a media-generation request without starting it. Use only when the user asks to preview or validate settings.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: generationRequestProperties,
        required: ['outputType', 'settingsToken'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startMediaGeneration',
      description: 'Start one real paid AI image or video generation job that automatically imports completed media into MasterSelects. This is the correct tool for requests to generate an image or video. Inspect the model first and pass its settingsToken unchanged. Call this at most once per user message; never retry with another provider without a new explicit user request.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: generationRequestProperties,
        required: ['outputType', 'prompt', 'settingsToken', 'idempotencyKey'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMediaGenerationStatus',
      description: 'Read a started media-generation job and its automatic import status. Supply the recordId returned by startMediaGeneration or its idempotencyKey. A phase of importing is not a failure: keep polling this same record and never start a replacement job.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          idempotencyKey: { maxLength: 240, type: 'string' },
          recordId: { type: 'string' },
        },
        required: [],
      },
    },
  },
];

export const DIRECT_CODEX_EDITOR_TOOL_OVERRIDES: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getMediaPreviewFrames',
      description: 'Return one labeled contact-sheet image containing 20 evenly distributed frames from the complete imported video. Call this exactly once per candidate source, inspect all 20 cells in the single returned image, and reuse that evidence. Never request the same source contact sheet again in the same turn.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaFileId: {
            description: 'Exact video media source ID returned by getMediaItems.',
            type: 'string',
          },
        },
        required: ['mediaFileId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'startMediaTranscription',
      description: 'Ensure one imported video or audio source has a complete word-timed transcript. This call starts or joins transcription, waits internally until it is ready, and returns the transcript page. Do not poll getMediaItems after calling it.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaFileId: {
            description: 'Exact media source ID returned by getMediaItems.',
            type: 'string',
          },
          timeoutMs: {
            description: 'Optional wait timeout from 10000 to 300000 milliseconds. Default: 180000.',
            maximum: 300000,
            minimum: 10000,
            type: 'integer',
          },
        },
        required: ['mediaFileId'],
      },
    },
  },
];

const DIRECT_MEDIA_TOOL_NAMES = new Set(
  DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS.map((tool) => tool.function.name),
);

export function adaptDirectCodexToolArguments(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === 'getMediaPreviewFrames') {
    return { ...args, contactSheet: true };
  }
  if (toolName === 'startMediaTranscription') {
    return { ...args, waitForCompletion: true };
  }
  return DIRECT_MEDIA_TOOL_NAMES.has(toolName)
    ? { requestJson: JSON.stringify(args) }
    : args;
}
