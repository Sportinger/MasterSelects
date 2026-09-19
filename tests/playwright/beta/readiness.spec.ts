import { test, expect } from '@playwright/test'
import { waitForReady } from './readiness'

test('Readiness waits beyond a visible placeholder @readiness', async ({}, testInfo) => {
  let observations = 0
  const state = await waitForReady(testInfo, 'placeholder', async () => ({
    name: 'already-visible.mp4', isImporting: ++observations < 3,
  }), sample => sample.isImporting === false, 2_000)
  expect(observations).toBe(3)
  expect(state.isImporting).toBe(false)
})

test('Readiness rejects an observation that never finishes @readiness', async ({}, testInfo) => {
  await expect(waitForReady(testInfo, 'stalled-observation',
    () => new Promise<boolean>(() => {}), state => state === true, 100))
    .rejects.toThrow('Readiness timeout: stalled-observation')
})
