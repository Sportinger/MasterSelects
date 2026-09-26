import {
  AI_TOOLS,
  checkToolAccess,
  executeAITool,
  type CallerContext,
  type ToolDefinition,
  type ToolResult,
} from '../aiTools';
import { emitAgentActivity, safeToolActivityLabel } from './FlashBoardChatActivity';
import type {
  FlashBoardChatRequest,
  FlashBoardExecutedToolCall,
} from './FlashBoardChatTypes';
import {
  adaptDirectCodexToolArguments,
  DIRECT_CODEX_EDITOR_TOOL_OVERRIDES,
  DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS,
} from './FlashBoardDirectCodexMediaTools';
import {
  createDirectCodexTurnToolPolicy,
} from './FlashBoardDirectCodexTurnPolicy';
import { useMediaStore } from '../../stores/mediaStore';
import { getToolPolicy } from '../aiTools/policy';
import { NodeGraphStreamParser, NODE_GRAPH_STREAM_PROTOCOL } from '../nodeGraph/nodeGraphStream';
import { FlashBoardNodeGraphStream, type NodeStreamFailure } from './FlashBoardNodeGraphStream';
import { NodeStreamFeedback, nodeStreamUserNotice } from './FlashBoardNodeStreamFeedback';
import { DIRECT_EAGER_TOOLS, compactDirectToolEntry, directToolSchemaEntry, localDirectToolResult } from './FlashBoardDirectToolSurface';
import { directToolContentItems } from './FlashBoardDirectToolResultContent';
import { CodexStreamDiagnostics } from './CodexStreamDiagnostics';
import { yieldEditorPresentationFrame } from './yieldEditorPresentationFrame';
import {
  clearDirectCodexReloadSnapshot,
  readDirectCodexReloadSnapshot,
  saveDirectCodexReloadSnapshot,
} from './FlashBoardDirectCodexReloadResume';
import {
  directCodexToolFailure,
  runDirectCodexToolWithRecovery,
} from './FlashBoardDirectCodexToolRecovery';
import {
  readStoredDirectCodexThreadId,
  startOrResumeDirectCodexThread,
} from './FlashBoardDirectCodexThreadSession';
import { resolveDirectModelProfile } from './FlashBoardDirectModelProfile';

export { createDirectCodexTurnToolGuard } from './FlashBoardDirectCodexTurnPolicy';
export { runDirectCodexToolWithRecovery } from './FlashBoardDirectCodexToolRecovery';
export {
  buildDirectCodexBaseInstructions,
  resetDirectCodexSession,
} from './FlashBoardDirectCodexThreadSession';


type RpcId = number | string;

interface RpcMessage {
  error?: { code?: unknown; message?: unknown };
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
}

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function directCodexSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/direct-codex/ws`;
}

export async function prepareDirectCodexBrowserSession(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/api/me', {
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error('Codex Direct could not prepare the MasterSelects session.');
  }

  const payload = record(await response.json());
  const session = record(payload.session);
  if (session.authenticated !== true && session.guest !== true) {
    throw new Error('Codex Direct requires an active MasterSelects session.');
  }
}

export function buildDirectCodexDynamicTools(
  tools: readonly ToolDefinition[] = [
    ...DIRECT_CODEX_EDITOR_TOOL_OVERRIDES,
    ...AI_TOOLS,
    ...DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS,
  ],
  deferLoading = true,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const definitions = tools.flatMap((tool) => {
    const name = tool.function.name;
    if (seen.has(name)) return [];
    seen.add(name);
    // Without hosted tool search, a compact surface replaces deferred loading.
    if (!deferLoading) return compactDirectToolEntry(tool);
    return [{
      ...(deferLoading && !DIRECT_EAGER_TOOLS.has(name) ? { deferLoading: true } : {}),
      description: tool.function.description,
      inputSchema: tool.function.parameters,
      name,
      type: 'function',
    }];
  });
  if (!deferLoading) definitions.push(directToolSchemaEntry());
  return [{
    description: 'All MasterSelects browser-editor tools for the current Direct Codex session.',
    name: 'masterselects_editor',
    tools: definitions,
    type: 'namespace',
  }];
}

function callerForDirectTool(toolName: string): CallerContext | undefined {
  const callerPreference: readonly CallerContext[] = ['chat', 'internal', 'kernel', 'devBridge'];
  return callerPreference.find((caller) => checkToolAccess(toolName, caller, {
    executionMode: 'normal',
  }).allowed);
}

function directToolDefinitionsByName(): Map<string, ToolDefinition> {
  return new Map(
    [...AI_TOOLS, ...DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS, ...DIRECT_CODEX_EDITOR_TOOL_OVERRIDES]
      .map((tool) => [tool.function.name, tool]),
  );
}

export function normalizeDirectCodexToolArguments(
  toolName: string,
  args: Record<string, unknown>,
  mediaFiles: readonly { id: string; name: string }[] = useMediaStore.getState().files,
): Record<string, unknown> {
  const adapted = adaptDirectCodexToolArguments(toolName, args);
  if (toolName !== 'getMediaPreviewFrames' && toolName !== 'startMediaTranscription') {
    return adapted;
  }
  const requestedMediaId = typeof adapted.mediaFileId === 'string'
    ? adapted.mediaFileId.trim()
    : typeof adapted.mediaItemId === 'string'
      ? adapted.mediaItemId.trim()
      : '';
  if (!requestedMediaId) return adapted;
  const mediaFile = mediaFiles.find(candidate => (
    candidate.id === requestedMediaId || candidate.name === requestedMediaId
  ));
  if (!mediaFile) return adapted;
  const normalized = { ...adapted };
  delete normalized.mediaItemId;
  return { ...normalized, mediaFileId: mediaFile.id };
}

interface DirectNamedResultField {
  key: string;
  value: boolean | number | string;
}

function collectDirectNamedResultFields(
  value: unknown,
  fields: Map<string, DirectNamedResultField>,
): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) collectDirectNamedResultFields(entry, fields);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'boolean' || typeof entry === 'number' || typeof entry === 'string') {
      fields.set(key.toLowerCase(), { key, value: entry });
    } else {
      collectDirectNamedResultFields(entry, fields);
    }
  }
}

function summarizeDirectToolCounts(toolNames: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of toolNames) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ×${count}`).join(', ');
}

const GENERIC_RESULT_FIELDS: ReadonlySet<string> = new Set(['to', 'from', 'id', 'type', 'input', 'output', 'value', 'action', 'success']);
const promptMentionsWord = (text: string, word: string) => text.split(/[^a-z0-9_]+/).includes(word);
const reportsField = (text: string, word: string) => text.split('\n').some(line => line.trim().replace(/^[-*]\s*/, '').startsWith(`${word}:`));

export function buildDirectCodexVerifiedResponse(
  prompt: string,
  modelResponse: string,
  toolCalls: readonly FlashBoardExecutedToolCall[],
): string {
  if (toolCalls.length === 0) return modelResponse;
  if (toolCalls.some(call => !call.result.success)) return modelResponse;
  // Read-only results can contain many entities with repeated `id`/`value` fields.
  // Flattening them into a single verified field destroys the discovery answer.
  if (toolCalls.some(call => ['searchNodeCatalog', 'getNodeDefinitions', 'focusNodeGraph', 'getOperatorGraph'].includes(call.toolCall.name))
    && toolCalls.every(call => getToolPolicy(call.toolCall.name)?.readOnly === true)) {
    return modelResponse;
  }

  const availableFields = new Map<string, DirectNamedResultField>();
  for (const call of toolCalls) {
    if (call.result.success) collectDirectNamedResultFields(call.result.data, availableFields);
  }
  const promptLower = prompt.toLowerCase();
  const responseLower = modelResponse.toLowerCase();
  // Whole words only: graph edges carry `to`/`from` fields that prose like "nodes to make" must not select.
  // A field is only corrected when the model itself reported it as `field: value`; prose such as
  // "moody color grade" must never replace the whole answer with one result field.
  const requestedFields = [...availableFields.entries()]
    .filter(([lowerKey]) => !GENERIC_RESULT_FIELDS.has(lowerKey) && promptMentionsWord(promptLower, lowerKey)
      && reportsField(responseLower, lowerKey))
    .map(([lowerKey, field]) => ({
      ...field,
      position: promptLower.indexOf(lowerKey),
    }))
    .toSorted((left, right) => left.position - right.position);
  if (requestedFields.length > 0) {
    return requestedFields.map(({ key, value }) => `${key}: ${String(value)}`).join('\n');
  }

  const successfulNames = toolCalls
    .filter(call => call.result.success)
    .map(call => call.toolCall.name);
  const summary = successfulNames.length > 0 ? `Tool-verifiziert ausgeführt: ${summarizeDirectToolCounts(successfulNames)}.` : '';
  // Keep the model's answer: it carries caveats (failed jobs, unverified parts) that tool success alone hides.
  return [modelResponse.trim(), summary].filter(Boolean).join('\n\n');
}

/** Reference material goes out once per thread; resumed turns already carry it in history. */
const NODE_CATALOG_ON_DEMAND = 'Before authoring nodes, call searchNodeCatalog with list: true once for the full compact inventory, then getNodeDefinitions once with every ID you need.';

export function directTurnInput(request: FlashBoardChatRequest, includeReference = true): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = [{
    text: request.prompt,
    type: 'text',
  }];
  // The ~8k-token inventory is fetched on demand (searchNodeCatalog list), so
  // turns without node work do not carry it through every model call.
  if (includeReference) input.push({ type: 'text', text: JSON.stringify({ nodeCatalog: NODE_CATALOG_ON_DEMAND, nodeGraphStream: NODE_GRAPH_STREAM_PROTOCOL }) });
  for (const reference of request.visualReferences ?? []) {
    input.push({ detail: 'auto', type: 'image', url: reference.dataUrl });
  }
  return input;
}

function rpcFailure(message: RpcMessage): Error {
  const error = record(message.error);
  const detail = typeof error.message === 'string' ? error.message : 'unknown app-server error';
  return new Error(`Codex Direct failed: ${detail}`);
}

async function runDirectCodexChat(
  request: FlashBoardChatRequest,
  resumeOnly: boolean,
): Promise<string | null> {
  request.signal?.throwIfAborted();
  request.onPhase?.('provider');

  await prepareDirectCodexBrowserSession(request.signal);

  const socket = new WebSocket(directCodexSocketUrl());
  const pending = new Map<RpcId, PendingRequest>();
  const toolDefinitions = directToolDefinitionsByName();
  const turnToolPolicy = createDirectCodexTurnToolPolicy();
  const handledToolCallIds = new Set<string>();
  const executedToolCalls: FlashBoardExecutedToolCall[] = [];
  const streamDiagnostics = new CodexStreamDiagnostics();
  let toolResponseQueue: Promise<unknown> = Promise.resolve();
  let nextRequestId = 1;
  const reloadSnapshot = request.resumeMessageId
    ? readDirectCodexReloadSnapshot(request.resumeMessageId)
    : null;
  const modelProfileId = request.directModelProfile;
  const modelProfile = resolveDirectModelProfile(modelProfileId);
  let threadId = reloadSnapshot?.threadId
    ?? readStoredDirectCodexThreadId(request.conversationRef, modelProfileId)
    ?? '';
  let turnId = resumeOnly ? reloadSnapshot?.turnId ?? '' : '';
  let finalText = '';
  let terminalError: Error | undefined;
  let providerTurnCompleted = false;
  let streamedText = '';
  let completionResolve: (() => void) | undefined;
  let completionReject: ((error: Error) => void) | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });
  void completion.catch(() => undefined);

  const fail = (error: Error) => {
    terminalError = error;
    nodeStream.stop();
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    completionReject?.(error);
  };
  const send = (message: RpcMessage) => {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error('The Codex Direct connection is not open.');
    }
    socket.send(JSON.stringify(message));
  };
  const requestRpc = (method: string, params: unknown): Promise<unknown> => {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve });
      send({ id, method, params });
    });
  };
  const nodeStream = new FlashBoardNodeGraphStream(async (toolName, args, sequence) => {
    const callId = `${turnId}:${sequence}`;
    const caller = callerForDirectTool(toolName);
    if (!caller || resumeOnly) return { success: false, error: 'Node stream is unavailable in a resumed turn.' };
    const safeLabel = safeToolActivityLabel(toolName);
    emitAgentActivity(request, { kind: 'operation', operationId: callId, phase: 'started', safeLabel, toolName });
    const guarded = turnToolPolicy.beforeTool(toolName, args);
    const result = guarded ?? await runDirectCodexToolWithRecovery(toolName,
      signal => executeAITool(toolName, args, caller, {
        auditProviderToolCallId: callId, executionMode: request.toolExecutionMode ?? (request.intent === 'plan' ? 'plan' : 'normal'), guidedReplay: false, legacyFeedback: 'off', signal,
      }), request.signal);
    if (!guarded) turnToolPolicy.afterTool(toolName, args, result);
    const call = { modelContent: '', result, toolCall: { arguments: JSON.stringify(args), id: callId, name: toolName } };
    executedToolCalls.push(call); request.onExecutedToolCalls?.([call]);
    emitAgentActivity(request, { kind: 'operation', operationId: callId, phase: result.success ? 'completed' : 'failed', safeLabel, toolName });
    if (result.success && toolName !== 'focusNodeGraph') streamDiagnostics.operationCompleted();
    return result;
  }, request.signal);
  const streamFeedback = new NodeStreamFeedback(nodeStream.failures);
  // Steps rejected before execution never reach the audited tool boundary; keep them in the turn's history.
  let skippedStreamSteps = 0;
  const recordSkippedStreamStep = (failure: NodeStreamFailure | undefined) => {
    if (!failure || failure.executed) return;
    const callId = `${turnId}:node-stream-skipped:${++skippedStreamSteps}`;
    const call = { modelContent: '', result: { success: false, error: failure.error },
      toolCall: { arguments: JSON.stringify(failure.args), id: callId, name: failure.tool } };
    executedToolCalls.push(call); request.onExecutedToolCalls?.([call]);
    emitAgentActivity(request, { kind: 'operation', operationId: callId, phase: 'failed', safeLabel: safeToolActivityLabel(failure.tool), toolName: failure.tool });
  };
  const nodeParser = new NodeGraphStreamParser(record => {
    toolResponseQueue = toolResponseQueue.then(() => nodeStream.accept(record)).then(recordSkippedStreamStep).catch(error => {
      fail(error instanceof Error ? error : new Error('Node stream failed.'));
      throw error;
    });
    void toolResponseQueue.catch(() => undefined);
  }, rejection => {
    const failure = { seq: rejection.seq ?? 0, ref: '', tool: rejection.tool ?? 'record',
      args: rejection.args ?? {}, error: `Record skipped: ${rejection.reason}`, executed: false };
    nodeStream.failures.push(failure);
    recordSkippedStreamStep(failure);
  });
  const respondToTool = async (message: RpcMessage) => {
    const params = record(message.params);
    const callId = typeof params.callId === 'string' ? params.callId : '';
    const requestedThreadId = typeof params.threadId === 'string' ? params.threadId : '';
    const requestedTurnId = typeof params.turnId === 'string' ? params.turnId : '';
    const toolName = typeof params.tool === 'string' ? params.tool : '';
    if (message.id === undefined) return;
    if (!callId || !toolName) {
      const result = directCodexToolFailure(
        toolName || 'editorTool',
        new Error('Codex sent an incomplete tool request. Do not retry it.'),
      );
      send({
        id: message.id,
        result: { contentItems: directToolContentItems(result), success: false },
      });
      return;
    }
    if (requestedThreadId !== threadId || requestedTurnId !== turnId) {
      const result = directCodexToolFailure(
        toolName,
        new Error('This request belongs to an expired Direct turn. Do not retry it.'),
      );
      send({
        id: message.id,
        result: { contentItems: directToolContentItems(result), success: false },
      });
      return;
    }
    if (handledToolCallIds.has(callId)) {
      const result = directCodexToolFailure(
        toolName,
        new Error('This duplicate tool request was already handled. Do not retry it.'),
      );
      send({
        id: message.id,
        result: { contentItems: directToolContentItems(result), success: false },
      });
      return;
    }
    handledToolCallIds.add(callId);
    const localResult = localDirectToolResult(toolName, params.arguments, toolDefinitions);
    if (localResult) { send({ id: message.id, result: { contentItems: directToolContentItems(localResult), success: localResult.success } }); return; }
    const definition = toolDefinitions.get(toolName);
    const caller = callerForDirectTool(toolName);
    if (!definition || !caller) {
      send({
        id: message.id,
        result: {
          contentItems: [{ text: `MasterSelects tool is unavailable: ${toolName}`, type: 'inputText' }],
          success: false,
        },
      });
      return;
    }

    const safeLabel = safeToolActivityLabel(toolName);
    emitAgentActivity(request, {
      kind: 'operation',
      operationId: callId,
      phase: 'started',
      safeLabel,
      toolName,
    });
    let args: Record<string, unknown> = {};
    let result: ToolResult;
    try {
      const rawArgs = params.arguments;
      args = record(typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs);
      let executionArgs = normalizeDirectCodexToolArguments(toolName, args);
      if (
        toolName === 'startMediaGeneration'
        && request.conversationRef
        && typeof executionArgs.requestJson === 'string'
      ) {
        executionArgs = {
          ...executionArgs,
          requestJson: JSON.stringify({
            ...record(JSON.parse(executionArgs.requestJson)),
            originConversationRef: request.conversationRef,
          }),
        };
      }
      const guardedResult = turnToolPolicy.beforeTool(toolName, args);
      result = guardedResult ?? await runDirectCodexToolWithRecovery(
        toolName,
        signal => executeAITool(toolName, executionArgs, caller, {
          auditProviderToolCallId: callId,
          onBatchAction: async ({ index, total, tool, success }) => {
            emitAgentActivity(request, { kind: 'progress',
              label: `${safeToolActivityLabel(tool)} ${success ? 'completed' : 'failed'}`,
              current: index, total });
            await yieldEditorPresentationFrame();
          },
          executionMode: 'normal',
          guidedReplay: false,
          signal,
        }),
        request.signal,
      );
      if (guardedResult === undefined) {
        turnToolPolicy.afterTool(toolName, args, result);
      }
    } catch (error) {
      result = directCodexToolFailure(toolName, error);
    }
    const executedToolCall: FlashBoardExecutedToolCall = {
      modelContent: '',
      result,
      toolCall: { arguments: JSON.stringify(args), id: callId, name: toolName },
    };
    executedToolCalls.push(executedToolCall);
    request.onExecutedToolCalls?.([executedToolCall]);
    emitAgentActivity(request, {
      kind: 'operation',
      operationId: callId,
      phase: result.success ? 'completed' : 'failed',
      safeLabel,
      toolName,
    });
    await yieldEditorPresentationFrame();
    send({
      id: message.id,
      result: {
        contentItems: [...directToolContentItems(result), ...streamFeedback.takeModelContentItems()],
        success: result.success,
      },
    });
  };

  socket.addEventListener('message', (event) => {
    try {
      if (typeof event.data !== 'string') {
        throw new Error('Codex Direct returned an invalid protocol message.');
      }
      const message = JSON.parse(event.data) as RpcMessage;
      if (message.method === 'item/tool/call' && message.id !== undefined) {
        toolResponseQueue = toolResponseQueue
          .then(() => respondToTool(message))
          .catch(error => fail(error instanceof Error ? error : new Error('Codex Direct tool response failed.')));
        return;
      }
      if (message.method !== undefined && message.id !== undefined) {
        send({
          error: { code: -32_000, message: 'Unsupported Codex Direct server request.' },
          id: message.id,
        });
        fail(new Error(`Codex Direct requested unsupported authority: ${message.method}.`));
        return;
      }
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error !== undefined) waiter.reject(rpcFailure(message));
        else waiter.resolve(message.result);
        return;
      }

      const params = record(message.params);
      if (message.method === 'item/agentMessage/delta') {
        if (params.threadId !== threadId || params.turnId !== turnId) return;
        const delta = typeof params.delta === 'string' ? params.delta : '';
        if (delta) {
          streamedText += delta;
          streamDiagnostics.delta(delta);
          request.onTextDelta?.(delta);
          if (!resumeOnly) nodeParser.push(delta);
        }
      } else if (message.method === 'item/completed') {
        if (params.threadId !== threadId || params.turnId !== turnId) return;
        const item = record(params.item);
        if (item.type === 'agentMessage' && typeof item.text === 'string') finalText = item.text;
        if (item.type === 'agentMessage' && !resumeOnly && params.turnId === turnId) nodeParser.push('\n');
      } else if (message.method === 'turn/completed') {
        const turn = record(params.turn);
        if (turn.id !== turnId) return;
        streamDiagnostics.providerCompleted();
        providerTurnCompleted = turn.status === 'completed';
        if (turn.status === 'completed') completionResolve?.();
        else completionReject?.(new Error(`Codex Direct ended with status ${String(turn.status)}.`));
      } else if (message.method === 'error') {
        const error = record(params.error);
        if (params.willRetry === true) return;
        fail(new Error(
          typeof error.message === 'string' ? error.message : 'Codex Direct failed.',
        ));
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Codex Direct failed.'));
    }
  });
  socket.addEventListener('error', () => fail(new Error(
    'Codex Direct is unavailable. Start MasterSelects with npm run dev:full.',
  )));
  socket.addEventListener('close', () => {
    if (nodeParser.active && !providerTurnCompleted) fail(new Error('Codex disconnected during the node stream. Completed steps remain undoable.'));
    if (!finalText && !streamedText) fail(new Error('Codex Direct disconnected before completion.'));
  });

  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(
      'Codex Direct is unavailable. Start MasterSelects with npm run dev:full.',
    )), { once: true });
  });
  const abort = () => {
    if (threadId && turnId && socket.readyState === WebSocket.OPEN) {
      try {
        send({ id: nextRequestId++, method: 'turn/interrupt', params: { threadId, turnId } });
      } catch {
        // Closing the isolated channel is the final cancellation boundary.
      }
    }
    socket.close();
    fail(new DOMException('Codex Direct was cancelled.', 'AbortError'));
  };
  if (request.signal?.aborted) abort();
  else request.signal?.addEventListener('abort', abort, { once: true });

  try {
    await opened;
    await requestRpc('initialize', {
      capabilities: { experimentalApi: true, requestAttestation: false },
      clientInfo: { name: 'masterselects_direct', title: 'MasterSelects Codex Direct', version: '1' },
    });
    send({ method: 'initialized', params: {} });
    const session = await startOrResumeDirectCodexThread(
      requestRpc,
      buildDirectCodexDynamicTools(undefined, modelProfile.deferToolLoading),
      request.conversationRef,
      modelProfileId,
    );
    threadId = session.threadId;
    turnId = session.activeTurnId ?? '';
    if (!turnId && resumeOnly) {
      if (!session.completedText) return null;
      if (request.resumeMessageId) clearDirectCodexReloadSnapshot(request.resumeMessageId);
      return session.completedText;
    }
    if (!turnId) {
      const startedTurn = record(await requestRpc('turn/start', {
        approvalPolicy: 'never',
        effort: modelProfile.effort,
        input: directTurnInput(request, session.newThread === true),
        model: modelProfile.model,
        sandboxPolicy: { networkAccess: false, type: 'readOnly' },
        ...(modelProfile.serviceTier ? { serviceTier: modelProfile.serviceTier } : {}),
        threadId,
      }));
      turnId = String(record(startedTurn.turn).id ?? '');
      if (!turnId) throw new Error('Codex Direct did not create a turn.');
    }
    if (request.resumeMessageId) {
      saveDirectCodexReloadSnapshot({
        assistantMessageId: request.resumeMessageId,
        conversationRef: request.conversationRef?.trim() || 'default',
        ...(modelProfileId ? { modelProfile: modelProfileId } : {}),
        prompt: request.prompt,
        threadId,
        turnId,
      });
    }
    await completion;
    if (!resumeOnly) nodeParser.finish();
    await toolResponseQueue;
    if (terminalError) throw terminalError;
    const response = finalText.trim() || streamedText.trim();
    if (!response) throw new Error('Codex Direct returned no final message.');
    if (request.resumeMessageId) clearDirectCodexReloadSnapshot(request.resumeMessageId);
    // The chat collapses stream blocks for display, so the model's own final answer is shown.
    const answer = buildDirectCodexVerifiedResponse(request.prompt, response, executedToolCalls);
    const notice = nodeStreamUserNotice(nodeStream.failures, streamFeedback, executedToolCalls);
    return notice ? `${answer}\n\n${notice}` : answer;
  } finally {
    nodeStream.stop();
    if (nodeParser.active) {
      const timing = streamDiagnostics.finish(turnId);
      emitAgentActivity(request, { kind: 'progress',
        label: `Node-Stream: ${timing.deltas} Text-Deltas; ${timing.operationsBeforeCompletion} Schritte bei laufender Antwort. Erste Änderung: ${timing.firstOperationMs ?? '–'} ms; Antwortende: ${timing.providerCompletedMs ?? '–'} ms.${terminalError ? ` Unterbrochen: ${terminalError.message}` : ''}` });
    }
    request.signal?.removeEventListener('abort', abort);
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
}

export async function sendDirectCodexChat(request: FlashBoardChatRequest): Promise<string> {
  const response = await runDirectCodexChat(request, false);
  if (response === null) throw new Error('Codex Direct returned no final message.');
  return response;
}

export async function resumeDirectCodexChat(input: {
  assistantMessageId: string;
  request: FlashBoardChatRequest;
}): Promise<string | null> {
  const snapshot = readDirectCodexReloadSnapshot(input.assistantMessageId);
  if (!snapshot) return null;
  return runDirectCodexChat({
    ...input.request,
    agentPath: 'direct-codex',
    conversationRef: snapshot.conversationRef === 'default'
      ? undefined
      : snapshot.conversationRef,
    ...(snapshot.modelProfile ? { directModelProfile: snapshot.modelProfile } : {}),
    prompt: snapshot.prompt,
    resumeMessageId: snapshot.assistantMessageId,
  }, true);
}
