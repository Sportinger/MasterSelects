import type { BrowserConsoleEvidence } from '../fixtures/failureEvidence';

interface ConsoleErrorAllowance {
  id: string;
  owner: string;
  reason: string;
  matches: (entry: BrowserConsoleEvidence) => boolean;
}

// Keep this list intentionally narrow. Platform tests remove this allowance and
// start the Native Helper explicitly when they verify the integration itself.
export const CONSOLE_ERROR_ALLOWLIST: readonly ConsoleErrorAllowance[] = [
  {
    id: 'optional-native-helper-unavailable',
    owner: 'platform/native-helper',
    reason: 'The Foundation browser profile does not require the optional local Native Helper.',
    matches: (entry) => {
      const source = entry.location.url?.split('?')[0] ?? '';
      return source.endsWith('/src/services/nativeHelper/NativeHelperClient.ts')
        && /^WebSocket connection to 'ws:\/\/127\.0\.0\.1:9876\/?' failed:.*ERR_CONNECTION_REFUSED$/
          .test(entry.text);
    },
  },
];

export function unexpectedConsoleErrors(
  entries: readonly BrowserConsoleEvidence[],
): BrowserConsoleEvidence[] {
  return entries.filter((entry) => entry.type === 'error'
    && !CONSOLE_ERROR_ALLOWLIST.some((allowance) => allowance.matches(entry)));
}
