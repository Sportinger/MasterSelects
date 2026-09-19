import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
export const origin = 'http://127.0.0.1:4189'
export const endpoint = 'http://127.0.0.1:9228'
export const modulePath = '/assets/index-DhC4wGj2.js'
export const moduleSha256 = '5adef90cee99d6fc3c44839e1394968ed76c0cf898878c83ad55e7c215a4823c'
export const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function assertTarget(targets, id) {
  if (!id || targets.length !== 1 || targets[0].targetId !== id || targets[0].url !== origin + '/editor') {
    throw Error('Exactly one explicitly pinned existing MSTEST page is required')
  }
}
export function assertTool(name) {
  if (!['getStats', 'getTimelineState', 'getMasks', 'getMediaItems', 'getClipDetails',
    'getRuntimeDiagnostics', 'getPlaybackTrace', 'createComposition', 'createTrack'].includes(name)) {
    throw Error('Tool outside existing campaign boundary: ' + name)
  }
}
export function assertOwner(actual, expected) {
  if (!expected || actual !== expected) throw Error('Foreign resource ownership rejected')
}
export function safePackagePath(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.split('/').includes('..') || path.isAbsolute(relative)) throw Error('Unsafe package path')
  const resolved = path.resolve(root, relative)
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw Error('Unsafe package path')
  return resolved
}
// Root supplies an independently reviewed complete-package manifest, pinned by its
// exact SHA, not a self-declared artifact label. No package bytes are rewritten.
export async function verifyPackage(manifestPath, manifestSha256) {
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 || '')) throw Error('Exact package manifest hash required')
  const bytes = await readFile(manifestPath)
  if (sha(bytes) !== manifestSha256) throw Error('Package manifest changed')
  const manifest = JSON.parse(bytes)
  if (!manifest.directory || !Array.isArray(manifest.files) || !manifest.files.length) throw Error('Complete package manifest required')
  const seen = new Set()
  for (const file of manifest.files) {
    if (seen.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid package entry')
    seen.add(file.path)
    if (sha(await readFile(safePackagePath(manifest.directory, file.path))) !== file.sha256) throw Error('Package bytes changed: ' + file.path)
  }
  if (!manifest.files.some(file => file.path === 'assets' + modulePath && file.sha256 === moduleSha256)) throw Error('Pinned tool module absent from package')
  return { manifestSha256, modulePath, moduleSha256, files: manifest.files.length }
}
