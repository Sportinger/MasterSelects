// What the Direct workflow says when its socket (/api/direct-codex/ws) cannot be opened. A browser
// WebSocket reports a refused upgrade (relay 401/403/503, kernel 502) only as an 'error' or an early
// 'close', so the client cannot tell the causes apart. Development builds point at the local stack;
// production users get a plain, actionable sentence instead of a developer command.

export const DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE =
  'Codex Direct is unavailable. Start MasterSelects with npm run dev:full.';

export const DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE =
  'The assistant service cannot be reached right now. Editing by hand keeps working; try again in a moment.';

export function directCodexUnavailableMessage(isDevelopment: boolean = import.meta.env.DEV): string {
  return isDevelopment ? DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE : DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE;
}

/** True for the text of a failed answer whose request never reached the assistant service. */
export function isDirectCodexUnavailableMessage(text: string | null | undefined): boolean {
  const trimmed = text?.trim();
  return trimmed === DIRECT_CODEX_DEV_UNAVAILABLE_MESSAGE || trimmed === DIRECT_CODEX_SERVICE_UNREACHABLE_MESSAGE;
}
