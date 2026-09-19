import { describe, expect, it } from 'vitest'
import { unexpectedConsoleErrors } from '../playwright/assertions/consoleAssertions'
import type { BrowserConsoleEvidence } from '../playwright/fixtures/failureEvidence'
import { isExpectedReferenceMaskMetadataDiagnostic } from '../playwright/masks/referenceMaskDiagnostics'

const appUrl = 'http://127.0.0.1:4173/'
const observed: BrowserConsoleEvidence = {
  type: 'error',
  text: "[0:00:36.292] [BoxParser] Invalid box type: '\u00a9TIM'",
  location: { url: `${appUrl}src/services/runtimeDiagnostics.ts` },
  recordedAt: '2026-09-19T18:44:13.555Z',
}

describe('mask reference optional timecode diagnostic', () => {
  it('recognizes the exact known diagnostic without weakening the global policy', () => {
    expect(isExpectedReferenceMaskMetadataDiagnostic(observed, appUrl)).toBe(true)
    expect(unexpectedConsoleErrors([observed])).toEqual([observed])
  })

  it('accepts the same source with a Vite cache query', () => {
    expect(isExpectedReferenceMaskMetadataDiagnostic({
      ...observed,
      location: { url: `${observed.location.url}?t=123` },
    }, appUrl)).toBe(true)
  })

  it.each([
    "[0:00:36.292] [BoxParser] Invalid box type: '\u00a9TSC'",
    "[0:00:36.292] [BoxParser] Invalid box type: '????'",
    "[0:00:36.292] [BoxParser] Invalid box type: '\u00a9TIM'\nMP4 parsing error",
    'Failed to load resource: net::ERR_FILE_NOT_FOUND',
    'MP4 parsing timeout - file may have unsupported metadata',
  ])('keeps other diagnostics unexpected: %s', (text) => {
    expect(isExpectedReferenceMaskMetadataDiagnostic({ ...observed, text }, appUrl)).toBe(false)
  })

  it.each([
    undefined,
    'not-a-url',
    'https://other.example/src/services/runtimeDiagnostics.ts',
    `${appUrl}src/services/otherModule.ts`,
  ])('requires the observed same-origin console wrapper: %s', (url) => {
    expect(isExpectedReferenceMaskMetadataDiagnostic({
      ...observed, location: { url },
    }, appUrl)).toBe(false)
  })
})
