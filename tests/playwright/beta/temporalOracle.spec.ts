import { test, expect } from '@playwright/test'
import { assertSequence, readCounter, assertPatternLayout } from './temporalOracle'

const clips = { background: { startTime: 0, duration: 3 }, foreground: { startTime: 0, duration: 2.5 } }
const sequence = () => Array.from({ length: 90 }, (_, i) => ({ time: i / 30, background: i, foreground: i }))
test('Frame oracle accepts known motion and rejects freezes, skips, reorder and invalid timing @oracle', () => {
  expect(() => assertSequence(sequence(), clips)).not.toThrow()
  for (const defect of ['freeze', 'skip', 'reorder', 'black', 'timestamp', 'count']) {
    const frames = sequence()
    if (defect === 'freeze') frames[30].background = frames[29].background
    if (defect === 'skip') frames[30].foreground++
    if (defect === 'reorder') [frames[30].foreground, frames[31].foreground] = [frames[31].foreground, frames[30].foreground]
    if (defect === 'black') frames[30].background = 0
    if (defect === 'timestamp') frames[30].time = frames[29].time
    if (defect === 'count') frames.pop()
    expect(() => assertSequence(frames, clips), defect).toThrow()
  }
})
test('Frame oracle reads compressed-looking counters and rejects absent/color-corrupted cells @oracle', () => {
  const frame = Buffer.alloc(640 * 360 * 3)
  for (let bit = 0; bit < 7; bit++) for (let y = 8; y < 24; y++) for (let x = 32 + bit * 8; x < 40 + bit * 8; x++) {
    frame.fill((73 >> bit) & 1 ? 240 : 12, (y * 640 + x) * 3, (y * 640 + x) * 3 + 3)
  }
  expect(readCounter(frame, 32, 8)).toBe(73)
  frame[(13 * 640 + 34) * 3] = 120
  expect(readCounter(frame, 32, 8)).toBeNull()
  expect(() => assertPatternLayout(Buffer.alloc(frame.length), true, true)).toThrow('Unexpected pattern content')
  expect(() => assertPatternLayout(Buffer.alloc(frame.length), false, false)).not.toThrow()
})
