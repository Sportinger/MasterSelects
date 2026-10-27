import { describe, expect, it } from 'vitest'

import { parsePhoneDecimal } from '../../src/components/mobileSkin/audio/PhoneAudioControls'
import { middleTruncate } from '../../src/components/mobileSkin/transition/phoneMiddleTruncate'

describe('phone sheet layout helpers', () => {
  it('keeps the start and the extension of a long file name', () => {
    const name = 'frame-code-v1-360x640-30fps-long-take.mp4'
    const short = middleTruncate(name, 28)
    expect(short).toHaveLength(28)
    expect(short.startsWith('frame-code-v1')).toBe(true)
    expect(short.endsWith('.mp4')).toBe(true)
    expect(short).toContain('…')
    expect(middleTruncate('clip.mp4', 28)).toBe('clip.mp4')
  })

  it('reads typed decimals with a point or a comma', () => {
    expect(parsePhoneDecimal('0.5')).toBe(0.5)
    expect(parsePhoneDecimal('0,5')).toBe(0.5)
    expect(parsePhoneDecimal(' 25 ')).toBe(25)
    expect(Number.isNaN(parsePhoneDecimal('abc'))).toBe(true)
  })
})
