import { describe, expect, it } from 'vitest';

import { AI_TOOLS } from '../../src/services/aiTools';
import {
  buildDirectCodexBaseInstructions,
  directTurnInput,
  buildDirectCodexDynamicTools,
  buildDirectCodexVerifiedResponse,
  createDirectCodexTurnToolGuard,
  normalizeDirectCodexToolArguments,
  prepareDirectCodexBrowserSession,
  runDirectCodexToolWithRecovery,
} from '../../src/services/flashboard/FlashBoardDirectCodexTransport';
import {
  adaptDirectCodexToolArguments,
  DIRECT_CODEX_EDITOR_TOOL_OVERRIDES,
  DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS,
} from '../../src/services/flashboard/FlashBoardDirectCodexMediaTools';
import { createDirectCodexTurnToolPolicy } from '../../src/services/flashboard/FlashBoardDirectCodexTurnPolicy';
import {
  buildFlashBoardChatOptimisticMessages,
  buildFlashBoardChatSendPlan,
} from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import { resolveFlashBoardChatAgentMode } from '../../src/components/panels/flashboard/FlashBoardChatAgentMode';
import {
  cancelFlashBoardDirectChatRun,
  finishFlashBoardDirectChatRun,
  getFlashBoardDirectChatRunConversationRefsSnapshot,
  getFlashBoardDirectChatRunSnapshot,
  startFlashBoardDirectChatRun,
} from '../../src/services/flashboard/FlashBoardDirectChatRun';
import {
  clearDirectCodexReloadSnapshot,
  hasDirectCodexReloadSnapshot,
  readDirectCodexReloadSnapshot,
  saveDirectCodexReloadSnapshot,
} from '../../src/services/flashboard/FlashBoardDirectCodexReloadResume';
import {
  readDirectCodexThreadSession,
  resetDirectCodexSession,
  startOrResumeDirectCodexThread,
} from '../../src/services/flashboard/FlashBoardDirectCodexThreadSession';
import { normalizeFlashBoardChatMessage } from '../../src/services/project/flashBoardChatProjectCodec';

describe('FlashBoard Codex Direct path', () => {
  it('preserves partial graph verification instead of matching x inside Mix', () => {
    const answer = 'Blue Mix % is 75; one node inspected.';
    expect(buildDirectCodexVerifiedResponse('Prüfe den Blue-Mix-Regler.', answer, [{
      toolCall: { id: 'graph-read', name: 'getOperatorGraph', arguments: '{}' },
      result: { success: true, data: { nodes: [{ id: 'amount', constants: { value: 75 }, position: { x: -520, y: 500 } }] } },
    }])).toBe(answer);
  });
  it('preserves catalog answers instead of replacing requested IDs with the last parameter ID', () => {
    const answer = '487 entries. effect:gaussian-blur; control:control.time. Time basis: clip, timeline.';
    expect(buildDirectCodexVerifiedResponse('Nenne die echten IDs und Time-basis-Werte.', answer, [{
      toolCall: { id: 'catalog-details', name: 'getNodeDefinitions', arguments: '{}' },
      result: { success: true, data: { definitions: [{ id: 'control:control.time', parameters: [{ id: 'basis', default: 'clip' }] }] } },
    }])).toBe(answer);
  });
  it('does not treat prose words like "to" as requested graph result fields', () => {
    const response = buildDirectCodexVerifiedResponse('use basic nodes to make a color key', 'Built the key.', [
      { toolCall: { id: 'edit', name: 'editOperatorGraph', arguments: '{}' },
        result: { success: true, data: { edges: [{ from: 'frame', to: 'output' }] } } },
    ]);
    expect(response).not.toContain('to: output');
  });
  it('preserves an inspected graph focus answer instead of reporting an unrelated nested clip ID', () => {
    const answer = 'Video clip-a is selected; Nodes is next to Preview.';
    expect(buildDirectCodexVerifiedResponse('Open the video clip node panel.', answer, [
      { toolCall: { id: 'read', name: 'getTimelineState', arguments: '{}' },
        result: { success: true, data: { clips: [{ id: 'clip-a' }, { id: 'clip-audio' }] } } },
      { toolCall: { id: 'focus', name: 'focusNodeGraph', arguments: '{}' },
        result: { success: true, data: { clipId: 'clip-a', panel: 'node-workspace' } } },
    ])).toBe(answer);
  });
  it('points to the on-demand node inventory once per thread instead of inlining it', () => {
    const input = directTurnInput({ prompt: 'Build a node graph' });
    expect(input[0]).toEqual({ type: 'text', text: 'Build a node graph' });
    const reference = JSON.parse(input[1].text as string);
    expect(reference.nodeCatalog).toContain('searchNodeCatalog with list: true');
    expect(reference).toHaveProperty('nodeGraphStream');
    expect((input[1].text as string).length).toBeLessThan(4_000);
    expect(directTurnInput({ prompt: 'Next step' }, false)).toEqual([{ type: 'text', text: 'Next step' }]);
  });
  it('skips project inspection for standalone media generation requests', () => {
    const instructions = buildDirectCodexBaseInstructions();

    expect(instructions).toContain(
      'does not reference existing project media, do not inspect the timeline, media items, preview frames, or transcripts',
    );
    expect(instructions).toContain(
      'When a request depends on existing project media or timeline content, inspect the timeline and media once',
    );
    expect(instructions).toContain('Call MasterSelects editor tools sequentially');
    expect(instructions).toContain('Never run multiple editor tools concurrently or combine them with Promise.all');
    expect(instructions).not.toContain('Before the first editor mutation, inspect the timeline and media once');
    expect(instructions).toContain('do not fetch media items, preview frames or contact sheets');
    expect(instructions).toContain('Call them by name instead of searching the tool list');
  });

  it('returns a hanging editor tool to Codex as a failed tool result', async () => {
    let toolSignal: AbortSignal | undefined;
    const result = await runDirectCodexToolWithRecovery(
      'getMediaPreviewFrames',
      signal => {
        toolSignal = signal;
        return new Promise(() => undefined);
      },
      undefined,
      1,
    );

    expect(result).toMatchObject({
      success: false,
      data: {
        guidance: expect.stringContaining('Continue the conversation'),
        toolName: 'getMediaPreviewFrames',
      },
    });
    expect(result.error).toContain('Timed out');
    expect(toolSignal?.aborted).toBe(true);
  });

  it('restores a pending Direct chat bubble after a page reload', () => {
    const assistantMessageId = 'assistant-direct-reload-1';
    saveDirectCodexReloadSnapshot({
      assistantMessageId,
      conversationRef: 'conversation-direct-reload-1',
      prompt: 'Create a reel.',
      threadId: '01a03e04-fa23-7cf0-98b9-26814005eeaf',
      turnId: '01a03e04-fa34-7cf0-98b9-26814005eeaf',
    });

    expect(hasDirectCodexReloadSnapshot(assistantMessageId)).toBe(true);
    expect(readDirectCodexReloadSnapshot(assistantMessageId)).toMatchObject({
      conversationRef: 'conversation-direct-reload-1',
      prompt: 'Create a reel.',
    });
    expect(normalizeFlashBoardChatMessage({
      id: assistantMessageId,
      isPending: true,
      role: 'assistant',
      text: 'Thinking...',
    })).toMatchObject({
      id: assistantMessageId,
      isPending: true,
      text: 'Reconnecting to kernel…',
    });

    clearDirectCodexReloadSnapshot(assistantMessageId);
  });

  it('keeps Direct prompt and config but swaps the model for the DeepSeek profile', async () => {
    resetDirectCodexSession();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const requestRpc = async (method: string, params: unknown) => {
      calls.push({ method, params: params as Record<string, unknown> });
      return { thread: { id: `thread-${calls.length}` } };
    };

    await startOrResumeDirectCodexThread(requestRpc, [], 'conversation-profile-1', 'codex');
    await startOrResumeDirectCodexThread(requestRpc, [], 'conversation-profile-1', 'deepseek');

    expect(calls.map(call => call.method)).toEqual(['thread/start', 'thread/start']);
    const [codex, deepseek] = calls.map(call => call.params);
    expect(codex.model).toBe('gpt-5.6-sol');
    expect(codex).not.toHaveProperty('modelProvider');
    expect(deepseek.model).toBe('deepseek-flash');
    expect(deepseek.modelProvider).toBe('deepseek');
    expect(deepseek.baseInstructions).toBe(codex.baseInstructions);
    expect(deepseek.config).toEqual(codex.config);

    calls.length = 0;
    await startOrResumeDirectCodexThread(requestRpc, [], 'conversation-profile-1', 'deepseek');
    expect(calls[0]).toMatchObject({
      method: 'thread/resume',
      params: { modelProvider: 'deepseek', threadId: 'thread-2' },
    });
    resetDirectCodexSession();
  });

  it('detects the in-progress turn returned by thread/resume', () => {
    expect(readDirectCodexThreadSession('thread-direct-1', {
      initialTurnsPage: {
        data: [{ id: 'turn-direct-1', items: [], status: 'inProgress' }],
      },
      thread: { id: 'thread-direct-1' },
    })).toEqual({
      activeTurnId: 'turn-direct-1',
      threadId: 'thread-direct-1',
    });
  });

  it('prepares a verified guest browser session before opening Direct', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      session: { authenticated: false, guest: true },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(prepareDirectCodexBrowserSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
    }));

    vi.unstubAllGlobals();
  });

  it('publishes every MasterSelects AI tool exactly once as a Codex dynamic tool', () => {
    const dynamicTools = buildDirectCodexDynamicTools();
    const namespace = dynamicTools[0];
    const namespacedTools = Array.isArray(namespace?.tools) ? namespace.tools : [];
    const expectedNames = [...new Set([
      ...AI_TOOLS,
      ...DIRECT_CODEX_MEDIA_TOOL_DEFINITIONS,
    ].map((tool) => tool.function.name))].toSorted();
    const actualNames = namespacedTools.map((tool) => String(tool.name)).toSorted();

    expect(actualNames).toEqual(expectedNames);
    expect(namespace?.type).toBe('namespace');
    expect(namespacedTools.every((tool) => tool.type === 'function')).toBe(true);
    const eager = new Set(['getTimelineState', 'searchNodeCatalog', 'getNodeDefinitions', 'createImageNodeGraph', 'editOperatorGraph', 'getOperatorGraph', 'focusNodeGraph', 'captureFrame']);
    expect(namespacedTools.filter((tool) => tool.deferLoading !== true).map((tool) => String(tool.name)).toSorted()).toEqual([...eager].toSorted());
    expect(namespacedTools.every((tool) => tool.inputSchema !== undefined)).toBe(true);
    expect(actualNames).toContain('inspectMediaGenerationModel');
    expect(actualNames).toContain('startMediaGeneration');
    expect(actualNames).toContain('getMediaGenerationStatus');
    const preview = namespacedTools.find((tool) => tool.name === 'getMediaPreviewFrames');
    const transcription = namespacedTools.find((tool) => tool.name === 'startMediaTranscription');
    expect(preview?.description).toContain('20 evenly distributed frames');
    expect(transcription?.description).toContain('waits internally');
    expect(DIRECT_CODEX_EDITOR_TOOL_OVERRIDES).toHaveLength(2);
  });

  it('adapts clean Direct Codex media arguments to the existing editor boundary', () => {
    const args = {
      outputType: 'image',
      prompt: 'A tree',
      settingsToken: 'sha256:test',
      idempotencyKey: 'kernel-media-generation:direct-tree-test',
    };

    expect(adaptDirectCodexToolArguments('startMediaGeneration', args)).toEqual({
      requestJson: JSON.stringify(args),
    });
    expect(adaptDirectCodexToolArguments('getTimelineState', args)).toBe(args);
    expect(adaptDirectCodexToolArguments('getMediaPreviewFrames', {
      mediaFileId: 'media-1',
    })).toEqual({ mediaFileId: 'media-1', contactSheet: true });
    expect(adaptDirectCodexToolArguments('startMediaTranscription', {
      mediaFileId: 'media-1',
    })).toEqual({ mediaFileId: 'media-1', waitForCompletion: true });
  });

  it('normalizes common media-id variants without another model retry', () => {
    const mediaFiles = [{ id: 'media-1', name: '1.mp4' }];

    expect(normalizeDirectCodexToolArguments(
      'getMediaPreviewFrames',
      { mediaItemId: 'media-1', frameCount: 20 },
      mediaFiles,
    )).toEqual({ contactSheet: true, frameCount: 20, mediaFileId: 'media-1' });
    expect(normalizeDirectCodexToolArguments(
      'getMediaPreviewFrames',
      { mediaFileId: '1.mp4' },
      mediaFiles,
    )).toEqual({ contactSheet: true, mediaFileId: 'media-1' });
  });

  it('allows only one paid media-generation start per user message', () => {
    const guard = createDirectCodexTurnToolGuard();

    expect(guard('getTimelineState')).toBeUndefined();
    expect(guard('startMediaGeneration')).toBeUndefined();
    expect(guard('getMediaGenerationStatus')).toBeUndefined();
    expect(guard('startMediaGeneration')).toMatchObject({
      success: false,
      data: { reason: 'direct_turn_media_generation_limit' },
    });
  });

  it('suppresses identical reads until a successful mutation changes project state', () => {
    const policy = createDirectCodexTurnToolPolicy();
    const args = {};
    const timelineResult = { success: true, data: { totalClips: 0 } };

    expect(policy.beforeTool('getTimelineState', args)).toBeUndefined();
    policy.afterTool('getTimelineState', args, timelineResult);
    expect(policy.beforeTool('getTimelineState', args)).toMatchObject({
      success: true,
      data: { reason: 'direct_duplicate_read_suppressed' },
    });
    expect(policy.beforeTool('createComposition', { name: 'Ad' })).toBeUndefined();
    policy.afterTool('createComposition', { name: 'Ad' }, { success: true });
    expect(policy.beforeTool('getTimelineState', args)).toBeUndefined();
  });

  it('hard-blocks repeated reads and duplicate successful mutations', () => {
    const policy = createDirectCodexTurnToolPolicy();

    expect(policy.beforeTool('getMediaItems', {})).toBeUndefined();
    policy.afterTool('getMediaItems', {}, { success: true, data: { files: [] } });
    expect(policy.beforeTool('getMediaItems', {})).toMatchObject({ success: true });
    expect(policy.beforeTool('getMediaItems', {})).toMatchObject({
      success: false,
      data: { reason: 'direct_identical_read_limit' },
    });

    const mutationArgs = { trackId: 'video-1' };
    expect(policy.beforeTool('createTrack', mutationArgs)).toBeUndefined();
    policy.afterTool('createTrack', mutationArgs, { success: true });
    expect(policy.beforeTool('createTrack', mutationArgs)).toMatchObject({
      success: false,
      data: { reason: 'direct_duplicate_mutation_blocked' },
    });
  });

  it('replaces model paraphrases with exact named values from successful tool results', () => {
    const response = buildDirectCodexVerifiedResponse(
      'Report frameCount, visualReviewKind and source.',
      'frameCount: 20\nvisualReviewKind: contact-sheet\nsource: 1.mp4',
      [{
        modelContent: '',
        result: {
          success: true,
          data: {
            frameCount: 20,
            source: 'thumbnail-cache',
            visualReviewKind: 'source-contact-sheet-20-v2',
          },
        },
        toolCall: {
          arguments: '{"mediaFileId":"media-1"}',
          id: 'tool-1',
          name: 'getMediaPreviewFrames',
        },
      }],
    );

    expect(response).toBe([
      'frameCount: 20',
      'visualReviewKind: source-contact-sheet-20-v2',
      'source: thumbnail-cache',
    ].join('\n'));
  });

  it('keeps the model answer when a prompt word only matches a result field in prose', () => {
    const answer = 'Applied a moody grade. The background job failed: no credits.';
    const response = buildDirectCodexVerifiedResponse('Give the people a moody color grade.', answer, [{
      modelContent: '',
      result: { success: true, data: { effectId: 'fx-1', params: { color: '#8d4dff' } } },
      toolCall: { arguments: '{}', id: 'fx', name: 'addEffect' },
    }]);
    expect(response).toContain(answer);
    expect(response).not.toContain('color: #8d4dff');
  });

  it('keeps the Codex reply when an editor tool fails', () => {
    const modelResponse = 'Das Bild konnte ich diesmal nicht erzeugen. Ich kann es mit anderen Einstellungen erneut versuchen.';
    const response = buildDirectCodexVerifiedResponse(
      'Erzeuge ein Bild.',
      modelResponse,
      [{
        modelContent: modelResponse,
        result: { success: false, error: 'Generation timed out.' },
        toolCall: {
          arguments: '{}',
          id: 'tool-failed-1',
          name: 'startMediaGeneration',
        },
      }],
    );

    expect(response).toBe(modelResponse);
  });

  it('routes directly without hosted availability or flattened chat history', () => {
    const plan = buildFlashBoardChatSendPlan({
      activeChatModelId: 'hosted-normal-path',
      canUseHostedChat: false,
      chatAgentMode: 'direct',
      chatMessages: [
        { createdAt: 1, id: 'old-user', role: 'user', text: 'old request' },
        { createdAt: 2, id: 'old-assistant', role: 'assistant', text: 'old response' },
      ],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0,
      conversationRef: 'conversation-direct-1',
      effectiveChatPrompt: 'Create a tree image.',
      hasHostedSession: false,
      hostedAIEnabled: false,
      isChatting: false,
      openAiReasoningEffort: 'none',
      planThreeEnabled: false,
    });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.agentPath).toBe('direct-codex');
    expect(plan.request.conversationRef).toBe('conversation-direct-1');
    expect(plan.request.hostedAvailable).toBe(false);
    expect(plan.request.prompt).toContain('Create a tree image.');
    expect(plan.request.prompt).not.toContain('old request');
    expect(plan.request.prompt).not.toContain('old response');
  });

  it('binds visible Direct messages to the shared workspace conversation', () => {
    const messages = buildFlashBoardChatOptimisticMessages({
      assistantMessageId: 'assistant-direct-1',
      conversationRef: 'conversation-direct-1',
      userMessageId: 'user-direct-1',
      userPrompt: 'Continue the edit.',
    });

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => (
      message.conversationRef === 'conversation-direct-1'
    ))).toBe(true);
  });

  it('keeps one Direct run alive until it is finished or explicitly stopped', () => {
    cancelFlashBoardDirectChatRun();
    const firstRun = startFlashBoardDirectChatRun('conversation-direct-1');

    expect(firstRun).not.toBeNull();
    expect(getFlashBoardDirectChatRunSnapshot()).toBe(true);
    expect(startFlashBoardDirectChatRun('conversation-direct-1')).toBeNull();

    finishFlashBoardDirectChatRun(firstRun!);
    expect(firstRun?.signal.aborted).toBe(false);
    expect(getFlashBoardDirectChatRunSnapshot()).toBe(false);

    const secondRun = startFlashBoardDirectChatRun('conversation-direct-1');
    expect(cancelFlashBoardDirectChatRun()).toBe(true);
    expect(secondRun?.signal.aborted).toBe(true);
    finishFlashBoardDirectChatRun(secondRun!);
  });

  it('allows independent Direct runs for different chat workspaces', () => {
    cancelFlashBoardDirectChatRun();
    const firstRun = startFlashBoardDirectChatRun('conversation-direct-a');
    const secondRun = startFlashBoardDirectChatRun('conversation-direct-b');

    expect(firstRun).not.toBeNull();
    expect(secondRun).not.toBeNull();
    expect(getFlashBoardDirectChatRunConversationRefsSnapshot()).toEqual([
      'conversation-direct-a',
      'conversation-direct-b',
    ]);
    expect(getFlashBoardDirectChatRunSnapshot('conversation-direct-a')).toBe(true);
    expect(getFlashBoardDirectChatRunSnapshot('conversation-direct-b')).toBe(true);

    expect(cancelFlashBoardDirectChatRun('conversation-direct-a')).toBe(true);
    expect(firstRun?.signal.aborted).toBe(true);
    expect(secondRun?.signal.aborted).toBe(false);
    finishFlashBoardDirectChatRun(firstRun!);
    finishFlashBoardDirectChatRun(secondRun!);
  });

  it('preserves an explicitly selected direct session outside Normal Path capabilities', () => {
    expect(resolveFlashBoardChatAgentMode({
      availableAgentModes: ['standard', 'logic'],
      currentAgentMode: 'direct',
      explicitlySelected: true,
    })).toBe('direct');
  });
});
