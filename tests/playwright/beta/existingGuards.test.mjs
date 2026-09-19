import test from 'node:test'
import assert from 'node:assert/strict'
import { assertTarget, assertTool, assertOwner, safePackagePath, verifyPackage, origin } from './existingGuards.mjs'
test('target guard rejects missing, foreign, additional and navigated pages', () => {
  const page = { targetId: 'explicit', url: origin + '/editor' }
  assert.doesNotThrow(() => assertTarget([page], 'explicit'))
  for (const [pages, id] of [[[], 'explicit'], [[page], ''], [[page], 'foreign'], [[page, page], 'explicit'], [[{ ...page, url: origin }], 'explicit']]) {
    assert.throws(() => assertTarget(pages, id))
  }
})
test('tool guard permits declared setup and observations, rejects bypasses and cleanup', () => {
  for (const name of ['getStats', 'getTimelineState', 'createComposition', 'createTrack']) assert.doesNotThrow(() => assertTool(name))
  for (const name of ['executeToolInternal', 'deleteComposition', 'reloadApp', 'clearRuntimeDiagnostics', 'sendChatMessage']) assert.throws(() => assertTool(name))
})
test('ownership guard rejects foreign and empty ownership', () => {
  assert.doesNotThrow(() => assertOwner('own', 'own'))
  assert.throws(() => assertOwner('foreign', 'own'))
  assert.throws(() => assertOwner('', ''))
})
test('package guard rejects traversal and absent exact pin before any read', async () => {
  for (const name of ['../secret', '/secret', 'assets/../../secret', '']) assert.throws(() => safePackagePath(process.cwd(), name))
  await assert.rejects(verifyPackage('not-read', ''), /Exact package manifest hash required/)
})

test('existing playback retains every legacy assertion and readiness threshold verbatim', async () => {
  const { readFile } = await import('node:fs/promises')
  const original = await readFile(new URL('./exportPlayback.ts', import.meta.url), 'utf8')
  const adapted = await readFile(new URL('./existingExportPlayback.ts', import.meta.url), 'utf8')
  const observations = source => source.split(/\r?\n/).map(line => line.trim()).filter(line => /^(expect\(|await waitForReady\(|const result = await waitForReady)/.test(line))
  assert.deepEqual(observations(adapted), observations(original))
})
