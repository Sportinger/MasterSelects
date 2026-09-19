import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import { registerGeneratedMedia, cleanupGeneratedMedia, finishExistingCase } from './existingResourceCleanup.mjs'

// All writes stay in this isolated workspace; only exact files are removed.
const root = path.resolve('output/aq104-resource-controls-' + process.pid)
test('exact generated media cleanup preserves export/oracle/error artifacts and rejects foreign owner', async () => {
  await mkdir(root, { recursive: true })
  const media = path.join(root, 'generated.webm'), artifact = path.join(root, 'oracle.json')
  try {
    await writeFile(media, 'generated'); await writeFile(artifact, 'retained')
    const record = await registerGeneratedMedia(root, 'case-1', media)
    await assert.rejects(cleanupGeneratedMedia(record, 'foreign'), /Foreign/)
    assert.equal(await readFile(media, 'utf8'), 'generated')
    const result = await cleanupGeneratedMedia(record, 'case-1')
    assert.equal(result.after.absent, true)
    assert.equal(await readFile(artifact, 'utf8'), 'retained')
    await assert.rejects(registerGeneratedMedia(root, 'case-1', artifact), /registration rejected/)
    await assert.rejects(registerGeneratedMedia(root, 'case-1', path.resolve('package.json')), /registration rejected/)
  } finally {
    for (const file of [media, artifact]) await unlink(file).catch(e => { if (e.code !== 'ENOENT') throw e })
    await rmdir(root)
  }
})
test('cleanup failure retains original exception identity and persists diagnostics', async () => {
  const original = Error('assertion failed'); let saved
  const result = await finishExistingCase({ original, cleanup: async () => { throw Error('cleanup failed') },
    persist: async report => { saved = report } })
  assert.equal(result.original, original)
  assert.match(saved.errors[0], /cleanup failed/)
})
test('successful body with failed cleanup is a failure', async () => {
  await assert.rejects(finishExistingCase({ cleanup: async () => ({ errors: ['dispose failed'] }),
    persist: async () => {} }), /cleanup incomplete/)
})
test('runner timeout remains primary even when evidence persistence fails', async () => {
  const original = { message: 'Test timeout exceeded' }
  const result = await finishExistingCase({ original, failed: true,
    cleanup: async () => ({ errors: [] }), persist: async () => { throw Error('disk full') } })
  assert.equal(result.original, original)
  assert.match(result.report.errors[0], /disk full/)
})

test('native containment and replacement controls refuse deletion', async () => {
  await mkdir(root, { recursive: true })
  const media = path.join(root, 'generated.webm')
  try {
    await writeFile(media, 'first')
    await assert.rejects(registerGeneratedMedia(root, 'case', path.join(root, '..', path.basename(root), '..', 'outside.webm')))
    const record = await registerGeneratedMedia(root, 'case', media)
    await writeFile(media, 'replacement has different bytes and size')
    await assert.rejects(cleanupGeneratedMedia(record, 'case'), /identity changed/)
    assert.equal(await readFile(media, 'utf8'), 'replacement has different bytes and size')
    await assert.rejects(registerGeneratedMedia(root, 'case', root + '/directory.webm'))
  } finally { await unlink(media).catch(e => { if (e.code !== 'ENOENT') throw e }); await rmdir(root) }
})
