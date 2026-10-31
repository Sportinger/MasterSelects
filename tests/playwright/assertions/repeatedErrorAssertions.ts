import type { BrowserConsoleEvidence, PageErrorEvidence } from '../fixtures/failureEvidence'

/**
 * Error storms: the same error logged again and again while the editor still looks fine.
 *
 * Production 3.4.1 (2026-10-29) logged one failed waveform save 1004 times in two hours and one
 * failed chat audit write 79 times; no journey noticed because the picture and the exported file
 * stayed right. Any journey that sees one error more often than this limit fails, whatever it
 * tests. A real retry with a pause stays far below it; a loop crosses it within seconds.
 */
export const REPEATED_ERROR_LIMIT = 20

export interface RepeatedError {
  signature: string
  count: number
  sample: string
}

/** Same error, different ids: UUIDs, hex ids and numbers become `#`. */
export function errorSignature(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b[0-9a-z]*\d[0-9a-z]*\b/gi, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

// A request the browser could not load is reported by the network stack, not by editor code;
// a missing optional local service would otherwise count as an error storm.
function isNetworkLoadError(entry: BrowserConsoleEvidence): boolean {
  return entry.text.startsWith('Failed to load resource')
}

export function findRepeatedErrors(
  consoleEntries: readonly BrowserConsoleEvidence[],
  pageErrors: readonly PageErrorEvidence[] = [],
  limit = REPEATED_ERROR_LIMIT,
): RepeatedError[] {
  const groups = new Map<string, RepeatedError>()
  const count = (text: string) => {
    const signature = errorSignature(text)
    const group = groups.get(signature)
    if (group) group.count += 1
    else groups.set(signature, { signature, count: 1, sample: text.slice(0, 400) })
  }
  for (const entry of consoleEntries) {
    if (entry.type === 'error' && !isNetworkLoadError(entry)) count(entry.text)
  }
  for (const error of pageErrors) count(`${error.name}: ${error.message}`)
  return [...groups.values()].filter((group) => group.count > limit).toSorted((a, b) => b.count - a.count)
}

export function describeRepeatedErrors(repeated: readonly RepeatedError[], limit = REPEATED_ERROR_LIMIT): string {
  return [
    `The editor logged the same error more than ${limit} times (error storm):`,
    ...repeated.map((group) => `  ${group.count}x ${group.sample}`),
  ].join('\n')
}
