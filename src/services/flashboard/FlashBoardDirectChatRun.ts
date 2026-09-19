interface FlashBoardDirectChatRun {
  abortController: AbortController;
  conversationRef: string;
}

const activeRuns = new Map<string, FlashBoardDirectChatRun>();
const listeners = new Set<() => void>();
let conversationRefsSnapshot: readonly string[] = [];

function emitChange(): void {
  conversationRefsSnapshot = [...activeRuns.keys()];
  for (const listener of listeners) listener();
}

export function getFlashBoardDirectChatRunSnapshot(conversationRef?: string): boolean {
  return conversationRef === undefined
    ? activeRuns.size > 0
    : activeRuns.has(conversationRef);
}

export function getFlashBoardDirectChatRunConversationRefsSnapshot(): readonly string[] {
  return conversationRefsSnapshot;
}

export function subscribeFlashBoardDirectChatRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startFlashBoardDirectChatRun(
  conversationRef: string,
): AbortController | null {
  if (activeRuns.has(conversationRef)) return null;

  const abortController = new AbortController();
  activeRuns.set(conversationRef, { abortController, conversationRef });
  emitChange();
  return abortController;
}

export function finishFlashBoardDirectChatRun(abortController: AbortController): void {
  const run = [...activeRuns.values()].find((candidate) => (
    candidate.abortController === abortController
  ));
  if (!run) return;
  activeRuns.delete(run.conversationRef);
  emitChange();
}

export function cancelFlashBoardDirectChatRun(conversationRef?: string): boolean {
  if (conversationRef !== undefined) {
    const run = activeRuns.get(conversationRef);
    if (!run) return false;
    run.abortController.abort();
    return true;
  }

  if (activeRuns.size === 0) return false;
  for (const run of activeRuns.values()) run.abortController.abort();
  return true;
}

export function isFlashBoardDirectChatRunController(
  abortController: AbortController | null,
): boolean {
  return abortController !== null && [...activeRuns.values()].some((run) => (
    run.abortController === abortController
  ));
}
