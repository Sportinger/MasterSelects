export const DIRECT_CODEX_MODEL = 'gpt-5.6-sol';

const DIRECT_CODEX_THREAD_KEY = 'masterselects.direct-codex.threads.v9';
const DIRECT_CODEX_PREVIOUS_THREAD_KEY = 'masterselects.direct-codex.threads.v8';
const DIRECT_CODEX_LEGACY_THREAD_KEY = 'masterselects.direct-codex.thread.v5';

export interface DirectCodexThreadSession {
  activeTurnId?: string;
  completedText?: string;
  threadId: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function directConversationKey(conversationRef?: string): string {
  return conversationRef?.trim() || 'default';
}

function readStoredThreadIds(): Record<string, string> {
  try {
    const value = window.sessionStorage.getItem(DIRECT_CODEX_THREAD_KEY)?.trim();
    if (!value) return {};
    const parsed = record(JSON.parse(value));
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => (
      typeof entry[1] === 'string' && entry[1].trim().length > 0
    )));
  } catch {
    return {};
  }
}

export function readStoredDirectCodexThreadId(
  conversationRef?: string,
): string | undefined {
  const stored = readStoredThreadIds()[directConversationKey(conversationRef)];
  if (stored) return stored;
  try {
    return window.sessionStorage.getItem(DIRECT_CODEX_LEGACY_THREAD_KEY)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function storeDirectCodexThreadId(threadId: string, conversationRef?: string): void {
  try {
    window.sessionStorage.setItem(DIRECT_CODEX_THREAD_KEY, JSON.stringify({
      ...readStoredThreadIds(),
      [directConversationKey(conversationRef)]: threadId,
    }));
    window.sessionStorage.removeItem(DIRECT_CODEX_PREVIOUS_THREAD_KEY);
    window.sessionStorage.removeItem(DIRECT_CODEX_LEGACY_THREAD_KEY);
  } catch {
    // The live module still retains the thread even when storage is unavailable.
  }
}

export function resetDirectCodexSession(conversationRef?: string): void {
  try {
    if (conversationRef === undefined) {
      window.sessionStorage.removeItem(DIRECT_CODEX_THREAD_KEY);
      window.sessionStorage.removeItem(DIRECT_CODEX_PREVIOUS_THREAD_KEY);
      window.sessionStorage.removeItem(DIRECT_CODEX_LEGACY_THREAD_KEY);
      return;
    }
    const stored = readStoredThreadIds();
    delete stored[directConversationKey(conversationRef)];
    if (Object.keys(stored).length === 0) window.sessionStorage.removeItem(DIRECT_CODEX_THREAD_KEY);
    else window.sessionStorage.setItem(DIRECT_CODEX_THREAD_KEY, JSON.stringify(stored));
    window.sessionStorage.removeItem(DIRECT_CODEX_PREVIOUS_THREAD_KEY);
    window.sessionStorage.removeItem(DIRECT_CODEX_LEGACY_THREAD_KEY);
  } catch {
    // A fresh thread will still be used after the next full page session.
  }
}

export function buildDirectCodexBaseInstructions(): string {
  return [
    'You are Codex Direct inside the MasterSelects browser editor.',
    'Complete the user request by calling the supplied MasterSelects tools directly.',
    'You may inspect and mutate the open project without asking for intermediate approval.',
    'Use tool results as the source of truth and never claim an action succeeded when its tool failed.',
    'If an editor tool fails or times out, stay in the conversation: explain what could not be completed and continue with another available approach when possible.',
    'Call MasterSelects editor tools sequentially. Never run multiple editor tools concurrently or combine them with Promise.all.',
    'For a request to generate a new image, video, speech, or music that does not reference existing project media, do not inspect the timeline, media items, preview frames, or transcripts. Inspect only the requested generator settings, then start the matching generation job.',
    'When a request depends on existing project media or timeline content, inspect the timeline and media once, review one 20-frame contact sheet per genuinely relevant candidate video, obtain only the transcripts genuinely needed, and settle a concise internal edit plan before the first editor mutation.',
    'Reuse every inspection result. Never repeat an identical read call in the same project state, and never call getMediaItems in a polling loop.',
    'The Direct version of startMediaTranscription waits internally and returns the transcript. Do not poll for its status.',
    'Choose either native caption clips or manually timed text clips before creating them. Do not create temporary caption objects merely to delete and replace them in the same turn.',
    'Read mutation results carefully: when a linked audio or video entity was already updated, do not repeat the same operation on its partner.',
    'Start at most one paid media-generation job per user message. After calling startMediaGeneration, only poll that same record; never retry or switch providers until the user explicitly asks in a later message.',
    'In the final response, mention only features directly proven by successful tool results and the final verified editor state. A business-name text clip is not a logo or logo end card.',
    'When the user asks for named tool-result fields, copy their exact values verbatim instead of paraphrasing or substituting a nearby field.',
    'You have no shell, filesystem, web, MCP, plugin, app, skill, or subagent access.',
    'Do not discuss implementation details unless the user asks; keep the final response concise.',
  ].join(' ');
}

function directThreadConfiguration(): Record<string, unknown> {
  return {
    approvalPolicy: 'never',
    baseInstructions: buildDirectCodexBaseInstructions(),
    config: {
      'agents.enabled': false,
      'features.apps': false,
      'features.browser_use': false,
      'features.code_mode': false,
      'features.computer_use': false,
      'features.connectors': false,
      'features.enable_mcp_apps': false,
      'features.goals': false,
      'features.hooks': false,
      'features.image_generation': false,
      'features.in_app_browser': false,
      'features.js_repl': false,
      'features.memories': false,
      'features.multi_agent': false,
      'features.plugins': false,
      'features.search_tool': false,
      'features.shell_tool': false,
      'features.skill_mcp_dependency_install': false,
      'features.tool_search': false,
      'features.tool_suggest': false,
      'features.unified_exec': false,
      'features.web_search': false,
      'memories.generate_memories': false,
      'shell_environment_policy.inherit': 'none',
      mcp_servers: {},
      web_search: 'disabled',
    },
    model: DIRECT_CODEX_MODEL,
    sandbox: 'read-only',
    serviceName: 'masterselects_direct',
  };
}

export function readDirectCodexThreadSession(
  threadId: string,
  resumed: Record<string, unknown>,
): DirectCodexThreadSession {
  const initialTurns = record(resumed.initialTurnsPage).data;
  const threadTurns = record(resumed.thread).turns;
  const turns = (Array.isArray(initialTurns) ? initialTurns : Array.isArray(threadTurns) ? threadTurns : [])
    .map(record);
  for (const turn of turns) {
    const id = typeof turn.id === 'string' ? turn.id : '';
    if (turn.status === 'inProgress' && id) return { activeTurnId: id, threadId };
  }
  for (const turn of turns) {
    if (turn.status !== 'completed') continue;
    const items = Array.isArray(turn.items) ? turn.items.map(record) : [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
        return { completedText: item.text.trim(), threadId };
      }
    }
  }
  return { threadId };
}

export async function startOrResumeDirectCodexThread(
  requestRpc: (method: string, params: unknown) => Promise<unknown>,
  dynamicTools: Array<Record<string, unknown>>,
  conversationRef?: string,
): Promise<DirectCodexThreadSession> {
  const storedThreadId = readStoredDirectCodexThreadId(conversationRef);
  if (storedThreadId) {
    try {
      const resumed = record(await requestRpc('thread/resume', {
        ...directThreadConfiguration(),
        initialTurnsPage: { itemsView: 'full', limit: 5, sortDirection: 'desc' },
        threadId: storedThreadId,
      }));
      const resumedThreadId = String(record(resumed.thread).id ?? '');
      if (resumedThreadId === storedThreadId) {
        return readDirectCodexThreadSession(resumedThreadId, resumed);
      }
    } catch {
      resetDirectCodexSession(conversationRef);
    }
  }

  const started = record(await requestRpc('thread/start', {
    ...directThreadConfiguration(),
    dynamicTools,
    ephemeral: false,
  }));
  const threadId = String(record(started.thread).id ?? '');
  if (!threadId) throw new Error('Codex Direct did not create a session.');
  storeDirectCodexThreadId(threadId, conversationRef);
  return { threadId };
}
