import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionGate } from './existingActionBoundary.ts'

test('deadline includes a stalled target check and forbids later actions', async () => {
  const gate = new ActionGate(() => new Promise(() => {}))
  let writes = 0
  await assert.rejects(gate.run('stalled check', async () => ++writes, 25), /completion unknown/)
  await assert.rejects(gate.run('next mutation', async () => ++writes), /stopped/)
  assert.equal(writes, 0)
  assert.equal(gate.outstanding, 1)
})
test('uncertain execution is never called cancelled or retried', async () => {
  const gate = new ActionGate(async () => {})
  let complete
  const execution = new Promise(resolve => { complete = resolve })
  await assert.rejects(gate.run('mutation', () => execution, 25), /completion unknown/)
  assert.equal(gate.records[0].completionUnknown, true)
  complete('finished late')
  assert.equal((await gate.settle(100)).outstanding, 0)
  await assert.rejects(gate.run('retry', async () => {}), /stopped/)
})
test('target/document mismatch fails before input dispatch', async () => {
  const gate = new ActionGate(async () => { throw Error('Existing document changed') })
  let dispatched = false
  await assert.rejects(gate.run('click', async () => { dispatched = true }), /document changed/)
  assert.equal(dispatched, false)
})
test('post-action target change invalidates the action and stops continuation', async () => {
  let checks = 0
  const gate = new ActionGate(async () => { if (++checks > 1) throw Error('Extra target') })
  await assert.rejects(gate.run('click', async () => 'clicked'), /Extra target/)
  await assert.rejects(gate.run('later click', async () => {}), /stopped/)
})
test('settled failed action permits only checked cleanup, not new actions', async () => {
  const gate = new ActionGate(async () => {})
  await assert.rejects(gate.run('failed click', async () => { throw Error('click failed') }), /click failed/)
  let cleaned = false
  await gate.cleanup('owner cleanup', async () => { cleaned = true })
  assert.equal(cleaned, true)
  await assert.rejects(gate.run('next click', async () => {}), /stopped/)
})
test('cleanup refuses changed identity even after an operation settles', async () => {
  let changed = false
  const gate = new ActionGate(async () => { if (changed) throw Error('document changed') })
  await assert.rejects(gate.run('failed click', async () => { throw Error('click failed') }), /click failed/)
  changed = true
  let cleaned = false
  await assert.rejects(gate.cleanup('owner cleanup', async () => { cleaned = true }), /document changed/)
  assert.equal(cleaned, false)
})
