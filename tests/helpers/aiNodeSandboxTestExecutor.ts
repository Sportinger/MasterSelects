import { runInNewContext } from 'node:vm';
import type { AINodeRuntimeTexture } from '../../src/services/nodeGraph/aiNodeRuntime';
import type { AINodeRuntimeInputValue } from '../../src/services/nodeGraph/aiNodeRuntimeGraphSignals';
import type {
  AINodeSandboxCode,
  AINodeSandboxNodeRequest,
  AINodeSandboxRunRequest,
} from '../../src/services/nodeGraph/aiNodeSandboxProtocol';

interface TestExecutable {
  process?: (
    input: Record<string, AINodeRuntimeInputValue>,
    context: AINodeSandboxNodeRequest['context'],
  ) => unknown;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function compileTestNode(code: string): TestExecutable {
  let captured: TestExecutable | null = null;
  runInNewContext(code, {
    Array,
    Boolean,
    JSON,
    Math,
    Number,
    Object,
    String,
    Uint8Array,
    Uint8ClampedArray,
    defineNode: (definition: TestExecutable) => {
      captured = definition;
      return definition;
    },
  });
  if (!captured) throw new Error('Test AI node did not call defineNode.');
  return captured;
}

function runTestNode(
  executable: TestExecutable,
  request: AINodeSandboxNodeRequest,
  current: AINodeRuntimeTexture,
): AINodeRuntimeTexture {
  if (!executable.process) return current;
  const time = {
    currentTime: request.context.clipLocalTime,
    clipLocalTime: request.context.clipLocalTime,
    seconds: request.context.clipLocalTime,
    mediaTime: request.context.mediaTime,
    valueOf: () => request.context.clipLocalTime,
    toString: () => String(request.context.clipLocalTime),
  };
  const metadata = { ...(current.metadata ?? {}), ...request.context.metadata };
  const signals: Record<string, AINodeRuntimeInputValue> = {
    ...request.context.signals,
    texture: current,
    time,
    params: request.context.params,
    metadata,
    connectedInputs: request.connectedInputs,
  };
  const context = { ...request.context, metadata, signals };
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
  const result = executable.process(input, context);
  const record = getRecord(result);
  const output = (record && 'output' in record ? record.output : result) as AINodeRuntimeTexture | undefined;
  if (!output?.data) return current;
  return {
    ...output,
    metadata: {
      ...metadata,
      ...(getRecord(record?.metadata) ?? {}),
      ...(getRecord(output.metadata) ?? {}),
    },
  };
}

export async function runAINodeSandboxTestExecutor(
  codes: readonly AINodeSandboxCode[],
  work: Omit<AINodeSandboxRunRequest, 'type' | 'requestId'>,
): Promise<AINodeRuntimeTexture> {
  const executableById = new Map(codes.map((node) => [node.id, compileTestNode(node.code)]));
  return work.nodes.reduce((current, request) => {
    if (request.kind === 'pixel-sort') return current;
    return runTestNode(executableById.get(request.id) ?? {}, request, current);
  }, work.texture);
}
