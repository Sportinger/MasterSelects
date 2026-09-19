import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { nativeHelperOrigin, mapNativeHelperOrigin } from './existingConsoleOrigin.ts'
import { unexpectedConsoleErrors } from '../assertions/consoleAssertions.ts'
import { origin } from './existingGuards.mjs'
const resource = { path: nativeHelperOrigin.asset, sha256: nativeHelperOrigin.sha256, matched: true }
const entry = { type: 'error', text: "WebSocket connection to 'ws://127.0.0.1:9876/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED",
  location: { url: origin + '/' + resource.path, lineNumber: 9, columnNumber: 0 }, recordedAt: 'qualification' }
test('same existing optional-helper predicate applies only to verified compiled source; raw entry unchanged', () => {
  const before = structuredClone(entry)
  assert.equal(unexpectedConsoleErrors([entry]).length, 1)
  assert.deepEqual(unexpectedConsoleErrors([mapNativeHelperOrigin(entry, resource)]), [])
  assert.deepEqual(entry, before)
  for (const changed of [
    { ...entry, text: entry.text.replace('9876', '9999') },
    { ...entry, text: 'Unrelated application exception' },
    { ...entry, location: { ...entry.location, lineNumber: 8 } },
    { ...entry, location: { ...entry.location, url: origin + '/assets/other.js' } },
    { ...entry, location: { ...entry.location, url: entry.location.url + '?unqualified' } },
  ]) assert.equal(unexpectedConsoleErrors([mapNativeHelperOrigin(changed, resource)]).length, 1)
  assert.throws(() => mapNativeHelperOrigin(entry, { ...resource, sha256: '0'.repeat(64) }), /Unverified/)
  assert.throws(() => mapNativeHelperOrigin(entry, { ...resource, matched: false }), /Unverified/)
})
test('pinned candidate constructor and exact source support declared compiled origin', async () => {
  const bytes = await readFile('E:/CodexTaskWorkspaces/MasterSelects/AQ-R6-project-name/packages/candidate/assets/' + resource.path)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), nativeHelperOrigin.sha256)
  const code = bytes.toString('utf8'), expression = 'new WebSocket(`ws://127.0.0.1:${this.config.port}`)'
  assert.equal([...code.matchAll(/new WebSocket\(/g)].length, 1)
  assert.equal(code.split(expression).length, 2)
  assert.equal(code.slice(0, code.indexOf(expression)).split('\n').length - 1, nativeHelperOrigin.line)
  const seal = JSON.parse(await readFile('E:/CodexTaskWorkspaces/MasterSelects/AQ-R6-project-name/packages/candidate/seal.json'))
  assert.equal(seal.baseline, 'f30de92d41d7b6097ed97799c454824f0ddca09e')
  assert.equal(seal.inputs.sourceFiles.find(file => file.path === 'src/services/nativeHelper/NativeHelperClient.ts').sha256, nativeHelperOrigin.sourceSha256)
  const source = execFileSync('git', ['show', seal.baseline + ':src/services/nativeHelper/NativeHelperClient.ts'])
  assert.equal(createHash('sha256').update(source).digest('hex'), nativeHelperOrigin.sourceSha256)
  assert.ok(source.toString('utf8').includes(expression))
  assert.equal(source.toString('utf8').split('\n').findIndex(line => line.includes(expression)), nativeHelperOrigin.sourceLine)
})
