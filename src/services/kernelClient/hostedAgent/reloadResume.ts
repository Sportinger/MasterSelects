import {
  clearHostedAgentFastV2ReloadSnapshot,
  hasHostedAgentFastV2ReloadSnapshot,
} from './fastV2ReloadResume';

const CLIENT_INSTANCE_KEY = 'masterselects.normalPath.clientInstance.v1';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
}

export function getHostedAgentClientInstanceId(): string {
  const target = storage();
  const existing = target?.getItem(CLIENT_INSTANCE_KEY);
  if (validIdentifier(existing)) return existing;
  const created = `page_${crypto.randomUUID().replace(/-/g, '')}`;
  try {
    target?.setItem(CLIENT_INSTANCE_KEY, created);
  } catch {
    // The in-memory identifier still supports the current page.
  }
  return created;
}

export function hasHostedAgentReloadSnapshot(assistantMessageId: string): boolean {
  return hasHostedAgentFastV2ReloadSnapshot(assistantMessageId);
}

export function clearHostedAgentReloadSnapshot(assistantMessageId: string): void {
  clearHostedAgentFastV2ReloadSnapshot(assistantMessageId);
}
