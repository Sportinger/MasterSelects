import type { Page } from '@playwright/test'
export function observeServing(page: Page, manifestPath: string, pin: string, stop: (reason: string) => void): Promise<{
  checkLoaded(): Promise<Array<{ path: string; sha256: string; matched: boolean }>>
  finish(loaderId?: string): Promise<{ passed: boolean; errors: string[]; [key: string]: unknown }>
}>
