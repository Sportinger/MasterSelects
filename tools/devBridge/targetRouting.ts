export type ExplicitBridgeTarget =
  | { provided: false }
  | { provided: true; valid: false; error: string }
  | { provided: true; valid: true; targetTabId: string }

export function parseExplicitBridgeTarget(payload: unknown): ExplicitBridgeTarget {
  if (!payload || typeof payload !== 'object') return { provided: false }
  if (!Object.prototype.hasOwnProperty.call(payload, 'targetTabId')) {
    return { provided: false }
  }

  const targetTabId = (payload as { targetTabId?: unknown }).targetTabId
  if (typeof targetTabId !== 'string' || targetTabId.trim().length === 0) {
    return {
      provided: true,
      valid: false,
      error: '"targetTabId" must be a non-empty string when provided',
    }
  }

  return { provided: true, valid: true, targetTabId }
}
