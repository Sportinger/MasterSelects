export type ExplicitBridgeTarget =
  | { provided: false }
  | { provided: true; valid: false; error: string }
  | { provided: true; valid: true; targetTabId: string }

const has = (payload: object, field: string) => Object.prototype.hasOwnProperty.call(payload, field)

/**
 * The tab a request names. `tabId` is accepted as well, because the status listing (GET
 * /api/ai-tools, clientTabs) names the field that way; it was ignored before and the request
 * then ran in whichever tab the bridge picked.
 */
export function parseExplicitBridgeTarget(payload: unknown): ExplicitBridgeTarget {
  if (!payload || typeof payload !== 'object') return { provided: false }
  const fields = (['targetTabId', 'tabId'] as const).filter(field => has(payload, field))
  if (fields.length === 0) return { provided: false }

  const values = fields.map(field => (payload as Record<string, unknown>)[field])
  const invalid = fields.find((_field, index) => typeof values[index] !== 'string' || (values[index] as string).trim().length === 0)
  if (invalid) {
    return {
      provided: true,
      valid: false,
      error: `"${invalid}" must be a non-empty string when provided`,
    }
  }
  if (values.length === 2 && values[0] !== values[1]) {
    return { provided: true, valid: false, error: '"targetTabId" and "tabId" name different tabs' }
  }

  return { provided: true, valid: true, targetTabId: values[0] as string }
}
