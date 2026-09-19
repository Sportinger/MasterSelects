/// <reference lib="webworker" />

import { validateAINodeGeneratedCode } from './aiNodeCodeValidation';
import type { AINodeRuntimeTexture } from './aiNodeRuntime';
import type { AINodeRuntimeContext, AINodeRuntimeInputValue } from './aiNodeRuntimeGraphSignals';
import type {
  AINodeSandboxRequest,
  AINodeSandboxResponse,
  AINodeSandboxRunRequest,
} from './aiNodeSandboxProtocol';

type AINodeProcessResult =
  | { output?: AINodeRuntimeTexture; metadata?: unknown; text?: unknown }
  | AINodeRuntimeTexture
  | undefined;

type AINodeProcessFunction = (
  input: Record<string, AINodeRuntimeInputValue>,
  context: AINodeRuntimeContext,
) => AINodeProcessResult;

interface AINodeExecutable {
  process?: AINodeProcessFunction;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
const sendResponse = scope.postMessage.bind(scope) as (
  response: AINodeSandboxResponse,
  transfer?: Transferable[],
) => void;
const executableById = new Map<string, AINodeExecutable>();
let initialized = false;

const BLOCKED_WORKER_GLOBALS = [
  'BroadcastChannel',
  'EventSource',
  'FileReader',
  'Function',
  'MessageChannel',
  'Notification',
  'OffscreenCanvas',
  'SharedWorker',
  'WebSocket',
  'WebTransport',
  'Worker',
  'XMLHttpRequest',
  'addEventListener',
  'caches',
  'close',
  'createImageBitmap',
  'crypto',
  'dispatchEvent',
  'eval',
  'fetch',
  'globalThis',
  'importScripts',
  'indexedDB',
  'location',
  'navigator',
  'onerror',
  'onmessage',
  'performance',
  'postMessage',
  'queueMicrotask',
  'removeEventListener',
  'self',
  'setInterval',
  'setTimeout',
] as const;

function disableWorkerGlobal(name: string): void {
  try {
    Object.defineProperty(scope, name, {
      configurable: false,
      enumerable: false,
      value: undefined,
      writable: false,
    });
  } catch {
    try {
      (scope as unknown as Record<string, unknown>)[name] = undefined;
    } catch {
      // A non-configurable browser global remains covered by AST validation.
    }
  }
}

function poisonFunctionConstructors(): void {
  const constructors = [
    Function,
    Object.getPrototypeOf(async function () {}).constructor,
    Object.getPrototypeOf(function* () {}).constructor,
    Object.getPrototypeOf(async function* () {}).constructor,
  ];
  for (const constructor of constructors) {
    try {
      Object.defineProperty(constructor.prototype, 'constructor', {
        configurable: false,
        enumerable: false,
        value: undefined,
        writable: false,
      });
    } catch {
      // The ordinary Function prototype is sufficient on engines that share it.
    }
  }
}

function lockDownWorkerCapabilities(): void {
  poisonFunctionConstructors();
  for (const name of BLOCKED_WORKER_GLOBALS) disableWorkerGlobal(name);
}

function compileNode(code: string): AINodeExecutable {
  const validation = validateAINodeGeneratedCode(code);
  if (!validation.valid) throw new Error(validation.error ?? 'Generated node code was rejected.');

  const holder: { captured: AINodeExecutable | null } = { captured: null };
  const defineNode = (definition: AINodeExecutable) => {
    holder.captured = definition;
    return definition;
  };
  const run = new Function('defineNode', `"use strict";\n${code}\n;`);
  run(defineNode);
  const captured = holder.captured;
  if (!captured || typeof captured.process !== 'function') {
    throw new Error('Generated node did not register a process function.');
  }
  return captured;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function createRuntimeTime(context: AINodeRuntimeContext) {
  return {
    currentTime: context.clipLocalTime,
    clipLocalTime: context.clipLocalTime,
    seconds: context.clipLocalTime,
    mediaTime: context.mediaTime,
    valueOf: () => context.clipLocalTime,
    toString: () => String(context.clipLocalTime),
  };
}

function mergeText(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (typeof patch === 'string') return { ...(getRecord(base) ?? {}), content: patch, text: patch };
  const patchRecord = getRecord(patch);
  return patchRecord ? { ...(getRecord(base) ?? {}), ...patchRecord } : base;
}

function getReturnedText(result: AINodeProcessResult, output: AINodeRuntimeTexture): unknown {
  if (output.text !== undefined) return output.text;
  const resultRecord = getRecord(result);
  if (resultRecord?.text !== undefined) return resultRecord.text;
  const metadataText = getRecord(getRecord(output.metadata)?.text);
  return typeof metadataText?.content === 'string'
    ? metadataText.content
    : typeof metadataText?.text === 'string'
      ? metadataText.text
      : undefined;
}

function normalizeOutput(
  current: AINodeRuntimeTexture,
  context: AINodeRuntimeContext,
  result: AINodeProcessResult,
): AINodeRuntimeTexture {
  const resultRecord = getRecord(result);
  const candidate = (resultRecord && 'output' in resultRecord ? resultRecord.output : result) as Partial<AINodeRuntimeTexture> | undefined;
  if (!candidate || !(candidate.data instanceof Uint8ClampedArray)) return current;
  if (candidate.width !== current.width || candidate.height !== current.height) return current;
  if (candidate.data.length !== current.width * current.height * 4) return current;

  const resultMetadata = getRecord(resultRecord?.metadata);
  const outputMetadata = getRecord(candidate.metadata);
  return {
    data: candidate.data,
    width: current.width,
    height: current.height,
    metadata: {
      ...context.metadata,
      ...(resultMetadata ?? {}),
      ...(outputMetadata ?? {}),
    },
    text: getReturnedText(result, candidate as AINodeRuntimeTexture) as AINodeRuntimeTexture['text'],
  };
}

function sortPixelsTexture(texture: AINodeRuntimeTexture): AINodeRuntimeTexture {
  const output = new Uint8ClampedArray(texture.data);
  const pixels = new Array<number>(texture.width * texture.height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    pixels[index] = (
      (texture.data[offset] << 24) |
      (texture.data[offset + 1] << 16) |
      (texture.data[offset + 2] << 8) |
      texture.data[offset + 3]
    ) >>> 0;
  }
  pixels.sort((a, b) => a - b);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const value = pixels[index];
    output[offset] = (value >>> 24) & 0xff;
    output[offset + 1] = (value >>> 16) & 0xff;
    output[offset + 2] = (value >>> 8) & 0xff;
    output[offset + 3] = value & 0xff;
  }
  return { ...texture, data: output };
}

function runGeneratedNode(
  current: AINodeRuntimeTexture,
  request: AINodeSandboxRunRequest['nodes'][number],
): AINodeRuntimeTexture {
  if (request.kind === 'pixel-sort') return sortPixelsTexture(current);
  const executable = executableById.get(request.id);
  if (!executable?.process) return current;

  const currentText = mergeText(request.context.text, current.text);
  const metadata = {
    ...(current.metadata ?? {}),
    ...request.context.metadata,
    ...(currentText === undefined ? {} : { text: currentText }),
  };
  const time = createRuntimeTime(request.context);
  const signals: Record<string, AINodeRuntimeInputValue> = {
    ...request.context.signals,
    texture: current,
    time,
    params: request.context.params,
    metadata,
    text: currentText as AINodeRuntimeInputValue,
    connectedInputs: request.connectedInputs,
  };
  const context: AINodeRuntimeContext = {
    ...request.context,
    metadata,
    signals,
    text: currentText as AINodeRuntimeContext['text'],
  };
  const input: Record<string, AINodeRuntimeInputValue> = {
    input: current,
    texture: current,
    time,
    metadata,
    params: context.params,
    clip: context.clip,
    source: context.source,
    graph: context.graph,
    node: context.node,
    signals,
    audio: context.audio,
    audioAnalysis: signals.audioAnalysis,
    frequencyBands: signals.frequencyBands,
    beats: signals.beats,
    onsets: signals.onsets,
    audioMetadata: signals.audioMetadata,
    audioRepairSuggestions: signals.audioRepairSuggestions,
    text: context.text,
    connectedInputs: request.connectedInputs,
    ...request.connectedInputs,
  };

  try {
    return normalizeOutput(current, context, executable.process(input, context));
  } catch {
    return current;
  }
}

function handleInit(request: Extract<AINodeSandboxRequest, { type: 'init' }>): void {
  if (initialized) throw new Error('AI node sandbox was already initialized.');
  for (const node of request.nodes) executableById.set(node.id, compileNode(node.code));
  lockDownWorkerCapabilities();
  initialized = true;
  sendResponse({ type: 'ready' });
}

function handleRun(request: AINodeSandboxRunRequest): void {
  if (!initialized) throw new Error('AI node sandbox is not initialized.');
  const texture = request.nodes.reduce(runGeneratedNode, request.texture);
  sendResponse({ type: 'result', requestId: request.requestId, texture }, [texture.data.buffer]);
}

scope.addEventListener('message', (event: MessageEvent<AINodeSandboxRequest>) => {
  try {
    if (event.data.type === 'init') handleInit(event.data);
    else handleRun(event.data);
  } catch (error) {
    sendResponse({
      type: 'error',
      ...(event.data.type === 'run' ? { requestId: event.data.requestId } : {}),
      error: error instanceof Error ? error.message : 'AI node sandbox failed.',
    });
  }
});
