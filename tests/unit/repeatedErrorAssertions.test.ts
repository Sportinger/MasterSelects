import { describe, expect, it } from 'vitest'
import {
  errorSignature,
  findRepeatedErrors,
} from '../playwright/assertions/repeatedErrorAssertions'
import type { BrowserConsoleEvidence } from '../playwright/fixtures/failureEvidence'

function consoleError(text: string): BrowserConsoleEvidence {
  return { type: 'error', text, location: {}, recordedAt: '2026-10-31T12:00:00.000Z' }
}

describe('Playwright error storm assertion', () => {
  it('groups the same error with different ids into one signature', () => {
    expect(errorSignature('Waveform pyramid storage waveform-pyramid:fe2b31d2-78ac-4a7e-9de2-eebdceac83e1 failed'))
      .toBe(errorSignature('Waveform pyramid storage waveform-pyramid:372c0df1-c9ab-4066-96d9-470f83ed70dc failed'))
  })

  it('reports an error repeated more often than the limit', () => {
    const storm = Array.from({ length: 25 }, (_, index) => consoleError(
      `[ClipProcessedWaveformAnalysis] Processed waveform generation failed: storage waveform-pyramid:${index}aa failed`,
    ))
    const repeated = findRepeatedErrors([...storm, consoleError('Something else')], [], 20)

    expect(repeated).toHaveLength(1)
    expect(repeated[0].count).toBe(25)
    expect(repeated[0].sample).toContain('Processed waveform generation failed')
  })

  it('ignores warnings, errors within the limit and browser network load errors', () => {
    const entries = [
      ...Array.from({ length: 30 }, () => consoleError('Failed to load resource: net::ERR_CONNECTION_REFUSED')),
      ...Array.from({ length: 30 }, () => ({ ...consoleError('slow frame'), type: 'warning' as const })),
      ...Array.from({ length: 5 }, () => consoleError('Export failed: busy')),
    ]

    expect(findRepeatedErrors(entries, [], 20)).toEqual([])
  })

  it('counts uncaught page errors too', () => {
    const pageErrors = Array.from({ length: 21 }, () => ({
      name: 'TypeError', message: 'x is undefined', recordedAt: '2026-10-31T12:00:00.000Z',
    }))

    expect(findRepeatedErrors([], pageErrors, 20)[0]).toMatchObject({ count: 21 })
  })
})
