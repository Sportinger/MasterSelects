import { describe, expect, it } from 'vitest'
import { parseExplicitBridgeTarget } from '../../tools/devBridge/targetRouting'

describe('dev bridge explicit target routing', () => {
  it('allows focused-session fallback only when targetTabId is absent', () => {
    expect(parseExplicitBridgeTarget({ action: 'probe' })).toEqual({ provided: false })
  })

  it.each([null, 17, true, '', '   '])(
    'rejects an explicitly supplied invalid target before routing: %j',
    (targetTabId) => {
      expect(parseExplicitBridgeTarget({ targetTabId })).toEqual({
        provided: true,
        valid: false,
        error: '"targetTabId" must be a non-empty string when provided',
      })
    },
  )

  it('takes tabId, the field name of the status listing, as the target', () => {
    expect(parseExplicitBridgeTarget({ tabId: 'tab-listed' })).toEqual({ provided: true, valid: true, targetTabId: 'tab-listed' })
    expect(parseExplicitBridgeTarget({ tabId: 'same', targetTabId: 'same' })).toEqual({ provided: true, valid: true, targetTabId: 'same' })
    expect(parseExplicitBridgeTarget({ tabId: '' })).toEqual({ provided: true, valid: false, error: '"tabId" must be a non-empty string when provided' })
    expect(parseExplicitBridgeTarget({ tabId: 'a', targetTabId: 'b' }))
      .toEqual({ provided: true, valid: false, error: '"targetTabId" and "tabId" name different tabs' })
  })

  it('preserves an exact explicit session id', () => {
    expect(parseExplicitBridgeTarget({ targetTabId: 'tab-md1-exact' })).toEqual({
      provided: true,
      valid: true,
      targetTabId: 'tab-md1-exact',
    })
  })
})
