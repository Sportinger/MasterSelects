import path from 'node:path'
import { lstat, realpath, unlink } from 'node:fs/promises'

function contained(root, file) {
  const relative = path.relative(root, file)
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw Error('Generated media must be an exact child file of test output')
  }
}
async function identity(root, file) {
  if (!path.isAbsolute(root) || !path.isAbsolute(file)) throw Error('Absolute native paths required')
  const resolvedRoot = await realpath(root)
  const resolvedFile = await realpath(file)
  contained(path.resolve(root), path.resolve(file))
  contained(resolvedRoot, resolvedFile)
  // Refuse junction/symlink ancestors even when their destinations are contained.
  let cursor = path.resolve(file)
  while (cursor !== path.resolve(root)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw Error('Linked generated media rejected')
    cursor = path.dirname(cursor)
  }
  if ((await lstat(root)).isSymbolicLink()) throw Error('Linked output root rejected')
  const stat = await lstat(file)
  if (!stat.isFile() || stat.nlink !== 1) throw Error('Only singly linked regular generated media allowed')
  return { path: path.resolve(file), realPath: resolvedFile, dev: stat.dev, ino: stat.ino,
    size: stat.size, mtimeMs: stat.mtimeMs }
}

// Only register media the case itself generated, after creation. Never register
// downloads/exports (oracle evidence), project files, profile files or directories.
export async function registerGeneratedMedia(outputRoot, owner, exactFile) {
  if (!owner || !/\.(mp4|webm|wav)$/i.test(exactFile)) throw Error('Generated media registration rejected')
  return { owner, outputRoot: path.resolve(outputRoot), identity: await identity(outputRoot, exactFile) }
}
export async function cleanupGeneratedMedia(record, requestedOwner) {
  if (record.owner !== requestedOwner) throw Error('Foreign resource ownership rejected')
  const before = await identity(record.outputRoot, record.identity.path)
  if (JSON.stringify(before) !== JSON.stringify(record.identity)) throw Error('Generated media identity changed')
  await unlink(before.path) // Exact file only. Never recursive and never directory removal.
  let absent = false
  try { await lstat(before.path) } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true }
  if (!absent) throw Error('Generated media still present')
  return { owner: requestedOwner, before, after: { path: before.path, absent } }
}

// Call with the caught primary error, including runner timeout from testInfo.errors.
// Cleanup is attempted for every exact registered media file; errors remain evidence.
export async function finishExistingCase({ cleanup, persist, original, failed = original !== undefined }) {
  let report
  try { report = await cleanup() }
  catch (error) { report = { errors: [String(error)] } }
  try { await persist(report) }
  catch (error) { report = { ...report, errors: [...(report.errors ?? []), 'persist: ' + String(error)] } }
  if (failed) return { report, original } // Caller rethrows original unchanged, if one was caught.
  if (report.errors?.length || report.remainingOwners?.length) {
    throw new AggregateError(report.errors ?? [], 'Existing resource cleanup incomplete')
  }
  return { report }
}
