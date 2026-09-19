import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { verify, inventory, digest } from '../../../scripts/windows-quality/pages-artifact.mjs'
import { inspectArtifact } from '../../../../masterselects-social/deploy/fassandra/repair/artifact-store.mjs'
import { observeReleaseProcess } from '../../../../masterselects-social/deploy/fassandra/repair/release-process-identity.mjs'
import { verifyPackage, sha, origin, modulePath } from './existingGuards.mjs'
import { withinDeadline } from './existingActionBoundary.ts'

export async function observeServing(page, manifestPath, pin, stop) {
  await verifyPackage(manifestPath, pin)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const seal = await verify(manifest.directory, manifest.sealSha256, manifest.sourceRevision)
  if (seal.artifactDigest !== manifest.payloadDigest || (await inspectArtifact(manifest.directory)).artifactDigest !== manifest.artifactDigest) throw Error('Complete package identity mismatch')
  const readPin = async reference => {
    if (!reference?.path || !/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw Error('Missing serving input pin')
    const bytes = await readFile(reference.path)
    if (sha(bytes) !== reference.sha256) throw Error('Serving input pin changed')
    return JSON.parse(bytes)
  }
  const runtime = await readPin(manifest.runtimeRecord)
  const backend = await readPin(manifest.backendProof)
  const selected = manifest.runtimeIdentity
  if (!selected || selected.pid !== runtime.pid || !selected.creationFiletime || runtime.status !== 'running' ||
      runtime.artifactDigest !== manifest.artifactDigest || !backend.passed || backend.artifactDigest !== manifest.artifactDigest) throw Error('Unqualified runtime binding')
  const workspace = path.dirname(manifest.runtimeRecord.path)
  const workerHash = seal.inputs.serverFiles[0].sha256
  const processProof = async () => {
    const current = await observeReleaseProcess(selected.pid)
    if (current.status !== 'present' || current.creationFiletime !== selected.creationFiletime) throw Error('Serving process identity changed')
    if (sha(await readFile(path.join(workspace, 'worker.js'))) !== workerHash) throw Error('Selected compiled worker changed')
    const expected = [...seal.inputs.frontendFiles, seal.files.find(file => file.path === 'assets/_routes.json')].map(file =>
      file.path === 'assets/_routes.json' ? { ...file, path: '_routes.json' } : file)
    const actual = await inventory(path.join(workspace, 'public'))
    const expectedByPath = new Map(expected.map(file => [file.path, file]))
    if (actual.length !== expectedByPath.size || actual.some(file => digest(file) !== digest(expectedByPath.get(file.path)))) throw Error('Serving public projection changed')
    return current
  }
  const before = await processProof()
  const resources = [], failures = [], pending = new Set()
  const startedAt = new Date().toISOString()
  const onResponse = response => {
    const url = new URL(response.url())
    if (url.origin !== origin) return
    const relative = url.pathname === '/editor' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
    const expected = seal.inputs.frontendFiles.find(file => file.path === relative)
    if (!expected) return
    const task = withinDeadline('Read loaded resource ' + relative, () => response.body(), 5000).then(bytes => {
      const actual = sha(bytes), matched = actual === expected.sha256 && response.status() === 200
      resources.push({ path: relative, sha256: actual, expected: expected.sha256, status: response.status(), matched })
      if (!matched) { failures.push('Loaded resource mismatch: ' + relative); stop(failures.at(-1)) }
    }).catch(error => { failures.push('Loaded resource read failed: ' + relative + ': ' + error); stop(failures.at(-1)) })
    pending.add(task); void task.finally(() => pending.delete(task))
  }
  page.on('response', onResponse)
  const checkLoaded = async () => {
    await Promise.all([...pending])
    if (failures.length) throw Error(failures.join('; '))
    if (!resources.some(row => row.path === 'index.html') || !resources.some(row => row.path === modulePath.slice(1))) throw Error('Loaded index/tool module evidence missing')
    return [...resources]
  }
  return {
    checkLoaded,
    async finish(loaderId) {
      const errors = []
      try { await checkLoaded() } catch (error) { errors.push(String(error)) }
      page.off('response', onResponse)
      let after
      try {
        await readPin(manifest.runtimeRecord); await readPin(manifest.backendProof)
        await verifyPackage(manifestPath, pin)
        await verify(manifest.directory, manifest.sealSha256, manifest.sourceRevision)
        after = await processProof()
      } catch (error) { errors.push(String(error)); stop(String(error)) }
      return { schema: 'mstest-case-serving-observation/v1', startedAt, finishedAt: new Date().toISOString(),
        targetId: process.env.MS_BETA_TARGET_ID, loaderId, origin, manifestSha256: pin,
        artifactDigest: manifest.artifactDigest, payloadDigest: manifest.payloadDigest, sourceRevision: manifest.sourceRevision,
        runtimeRecord: manifest.runtimeRecord, backendProof: manifest.backendProof, workerSha256: workerHash,
        before, after, resources, errors, passed: errors.length === 0,
        scope: 'Exact complete package, selected local Wrangler process/projection and actual loaded resources for this case interval. Existing backend proof reused. Not a controlled production release receipt.' }
    },
  }
}
