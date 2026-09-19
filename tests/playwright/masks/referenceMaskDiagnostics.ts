import type { BrowserConsoleEvidence } from '../fixtures/failureEvidence'

export const REFERENCE_MASK_METADATA_DIAGNOSTIC = {
  owner: 'upstream/mp4box.js',
  upstream: 'https://github.com/gpac/mp4box.js/issues/510',
  fixture: 'striped-motion.mp4',
  atom: 'moov/udta/\u00a9TIM',
  reason: 'MP4Box 2.3.0 rejects this optional QuickTime start-timecode tag. '
    + 'The mask journey separately verifies decoded export frames against the preview.',
} as const

// Local to the mask reference fixture: do not extend the shared console allowlist.
// Its valid 23-byte timecode atom starts at byte 18443; MP4Box rejects the FourCC
// because its parser only accepts ASCII. The observed console source is our wrapper.
export function isExpectedReferenceMaskMetadataDiagnostic(
  entry: BrowserConsoleEvidence,
  appUrl: string,
): boolean {
  if (entry.type !== 'error'
    || !/^\[\d+:\d{2}:\d{2}\.\d{3}\] \[BoxParser\] Invalid box type: '\u00a9TIM'$/.test(entry.text)
    || !entry.location.url) return false

  try {
    const source = new URL(entry.location.url)
    return source.origin === new URL(appUrl).origin
      && source.pathname === '/src/services/runtimeDiagnostics.ts'
  } catch {
    return false
  }
}
