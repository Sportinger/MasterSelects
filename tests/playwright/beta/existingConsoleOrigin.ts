import type { Page, TestInfo } from '@playwright/test'
import type { BrowserConsoleEvidence } from '../fixtures/failureEvidence'
import { CONSOLE_ERROR_ALLOWLIST, unexpectedConsoleErrors } from '../assertions/consoleAssertions.ts'
import { origin } from './existingGuards.mjs'

// Exact candidate asset: its sole WebSocket constructor is the unchanged
// NativeHelperClient ws://127.0.0.1:${this.config.port} call on zero-based line9.
// This maps source provenance only; the existing error predicate stays authoritative.
export const nativeHelperOrigin = Object.freeze({
  asset: 'assets/executionState-DA9Fmd4P.js',
  sha256: 'cb456d3df6fbf167eb319a3486096a2a7a50830e2f2ebe6cfe687a4a8e6af809',
  line: 9,
  source: '/src/services/nativeHelper/NativeHelperClient.ts',
  sourceLine: 146,
  sourceSha256: 'b0aff8df0a90d92f67e72811e19536c435d21fe2a22be7cfdafe2f8aed92de70',
})
type Resource = { path: string; sha256: string; matched: boolean }
const loadedOrigins = new WeakMap<Page, Resource>()
export function bindExistingConsoleOrigin(page: Page, resources: Resource[]) {
  const resource = resources.find(row => row.path === nativeHelperOrigin.asset && row.sha256 === nativeHelperOrigin.sha256 && row.matched)
  if (!resource) throw Error('Exact loaded Native Helper console origin missing')
  loadedOrigins.set(page, resource)
}
export function mapNativeHelperOrigin(entry: BrowserConsoleEvidence, resource: Resource) {
  if (resource.path !== nativeHelperOrigin.asset || resource.sha256 !== nativeHelperOrigin.sha256 || !resource.matched) {
    throw Error('Unverified compiled console origin')
  }
  if (entry.location.url !== origin + '/' + nativeHelperOrigin.asset || entry.location.lineNumber !== nativeHelperOrigin.line) return entry
  const canonical = { ...entry, location: { url: origin + nativeHelperOrigin.source, lineNumber: nativeHelperOrigin.sourceLine } }
  const allowance = CONSOLE_ERROR_ALLOWLIST.find(row => row.id === 'optional-native-helper-unavailable')
  return entry.type === 'error' && allowance?.matches(canonical) ? canonical : entry
}
export async function unexpectedExistingConsoleErrors(page: Page, entries: readonly BrowserConsoleEvidence[], testInfo: TestInfo) {
  const resource = loadedOrigins.get(page)
  if (!resource) throw Error('Existing console origin was not bound to loaded bytes')
  const mapped = entries.map(entry => mapNativeHelperOrigin(entry, resource))
  await testInfo.attach('compiled-console-origin', { body: JSON.stringify({ resource, mapping: nativeHelperOrigin,
    entries: entries.map((raw, index) => ({ raw, canonical: mapped[index], sourceMapped: raw !== mapped[index] })) }), contentType: 'application/json' })
  return unexpectedConsoleErrors(mapped)
}
