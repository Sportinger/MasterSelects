import type { TextClipProperties } from "../../types/text";
import type { ClipCustomNodeDefinition } from "../../types/nodeGraph";
import { extractAINodeGeneratedCode } from './aiNodeDefinition';
import { textRenderer } from '../textRenderer';
import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import type { AINodeRuntimeContext, AINodeRuntimeInputValue } from './aiNodeRuntimeGraphSignals';
import type { AINodeSandboxCode, AINodeSandboxNodeRequest } from './aiNodeSandboxProtocol';

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function mergeReturnedMetadata(
  base: Record<string, unknown>,
  output: AINodeRuntimeTexture | undefined,
  result?: unknown,
): Record<string, unknown> {
  const resultMetadata = getRecord(getRecord(result)?.metadata);
  if (!output?.metadata && !resultMetadata) {
    return base;
  }
  return {
    ...base,
    ...(resultMetadata ?? {}),
    ...(output?.metadata ?? {}),
  };
}

function renderTextSignalToTexture(
  texture: AINodeRuntimeTexture,
  baseText: TextClipProperties | undefined,
  returnedText: string | Partial<TextClipProperties> | undefined,
): AINodeRuntimeTexture {
  if (!baseText || returnedText === undefined || typeof document === 'undefined') {
    return texture;
  }

  const textPatch = typeof returnedText === 'string'
    ? { text: returnedText }
    : returnedText;
  const textPatchRecord = getRecord(textPatch);
  const normalizedTextPatch = textPatchRecord &&
    typeof textPatchRecord.content === 'string' &&
    typeof textPatchRecord.text !== 'string'
    ? { ...textPatch, text: textPatchRecord.content }
    : textPatch;
  const nextText = {
    ...baseText,
    ...normalizedTextPatch,
  };
  const canvas = textRenderer.createCanvas(texture.width, texture.height);
  textRenderer.render(nextText, canvas);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return texture;
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return {
    ...texture,
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
    text: returnedText,
    metadata: mergeReturnedMetadata(texture.metadata ?? {}, texture),
  };
}

export function resolveCurrentTextProperties(
  baseText: TextClipProperties | undefined,
  texture: AINodeRuntimeTexture,
): TextClipProperties | undefined {
  if (!baseText || texture.text === undefined) {
    return baseText;
  }

  if (typeof texture.text === 'string') {
    return {
      ...baseText,
      text: texture.text,
    };
  }

  return {
    ...baseText,
    ...texture.text,
  };
}

function createSerializableRuntimeTime(context: AINodeRuntimeContext): Record<string, number | undefined> {
  return {
    currentTime: context.clipLocalTime,
    clipLocalTime: context.clipLocalTime,
    seconds: context.clipLocalTime,
    mediaTime: context.mediaTime,
  };
}

export function createAINodeSandboxNodeRequest(
  definition: ClipCustomNodeDefinition,
  texture: AINodeRuntimeTexture,
  context: AINodeRuntimeContext,
  connectedInputs: Record<string, AINodeRuntimeInputValue> = {},
  pixelSort = false,
): { code?: AINodeSandboxCode; request: AINodeSandboxNodeRequest } | null {
  const code = extractAINodeGeneratedCode(definition.ai.generatedCode ?? '');
  if (!code) return null;
  const time = createSerializableRuntimeTime(context);
  const serializableContext: AINodeRuntimeContext = {
    ...context,
    signals: {
      ...context.signals,
      texture,
      time,
    },
  };
  return {
    ...(pixelSort ? {} : { code: { id: definition.id, code } }),
    request: {
      id: definition.id,
      kind: pixelSort ? 'pixel-sort' : 'generated',
      context: serializableContext,
      connectedInputs,
    },
  };
}

export function applyAINodeSandboxTextResult(
  texture: AINodeRuntimeTexture,
  baseText?: TextClipProperties,
): AINodeRuntimeTexture {
  return renderTextSignalToTexture(texture, baseText, texture.text);
}
