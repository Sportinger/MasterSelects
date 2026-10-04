import { afterEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ReferenceProjectFixture } from '../playwright/fixtures/referenceProject'
import type { ReferenceMediaFixture } from '../playwright/fixtures/mediaFixture'
import type { BridgeClient } from '../playwright/fixtures/bridgeClient'
import { addAllowedRoot, clearAllowedRoots, isPathAllowed } from '../../src/services/security/fileAccessBroker'

vi.mock('../playwright/fixtures/referenceVideoSeekIndex', () => ({
  prepareReferenceVideoSeekIndex: (bytes: Buffer) => bytes,
}))

const tempOverride = vi.hoisted(() => ({ path: undefined as string | undefined }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, tmpdir: () => tempOverride.path ?? actual.tmpdir() }
})

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()))
  clearAllowedRoots()
  tempOverride.path = undefined
})

describe('nested reference project workspace', () => {
  it('imports disposable media from an allowed root and removes it after use', async () => {
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'reference-source-'))
    cleanup.push(() => rm(sourceDirectory, { recursive: true, force: true }))
    const source = path.join(sourceDirectory, 'clip.mp4')
    await writeFile(source, 'reference-media')
    const roles = ['dynamic-landscape', 'high-frequency-60fps', 'longform-landscape']
    const media = {
      repoRoot: process.cwd(),
      files: roles.map(role => ({ role, kind: 'video', absolutePath: source })),
    } as ReferenceMediaFixture
    // Model Windows' short TEMP alias versus the server's canonical root.
    const canonicalTemp = await realpath(tmpdir())
    const tempAlias = path.join(sourceDirectory, 'temp-alias')
    await symlink(canonicalTemp, tempAlias, process.platform === 'win32' ? 'junction' : 'dir')
    tempOverride.path = tempAlias
    clearAllowedRoots()
    addAllowedRoot(canonicalTemp)
    const load = vi.fn(async (_action: string, args: {
      project: { name: string }, mediaSources: Array<{ path: string }>
    }) => {
      expect(args.mediaSources).toHaveLength(3)
      for (const item of args.mediaSources) {
        expect(isPathAllowed(item.path)).toBe(true)
        expect(await readFile(item.path, 'utf8')).toBe('reference-media')
      }
      return { projectName: args.project.name }
    })
    const bridge = { debugActionData: load, toolData: vi.fn() } as unknown as BridgeClient
    const fixture = new ReferenceProjectFixture(bridge, media)
    cleanup.push(() => fixture.dispose())

    const first = await fixture.createNestedSuperProject()
    const second = await fixture.createNestedSuperProject()
    expect(path.dirname(first.workingDirectory)).toBe(canonicalTemp)
    expect(first.workingDirectory).not.toBe(second.workingDirectory)
    expect(load).toHaveBeenCalledTimes(2)
    await access(first.projectFile)
    await fixture.dispose()
    await expect(access(first.workingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(second.workingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(source, 'utf8')).toBe('reference-media')
  })

  it('cleans up its workspace when snapshot loading fails', async () => {
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'reference-source-'))
    cleanup.push(() => rm(sourceDirectory, { recursive: true, force: true }))
    const source = path.join(sourceDirectory, 'clip.mp4')
    await writeFile(source, 'reference-media')
    let workspace = ''
    const bridge = {
      debugActionData: vi.fn(async (_action: string, args: { mediaSources: Array<{ path: string }> }) => {
        workspace = path.dirname(path.dirname(args.mediaSources[0].path))
        throw new Error('snapshot import failed')
      }),
    } as unknown as BridgeClient
    const media = {
      repoRoot: process.cwd(),
      files: ['dynamic-landscape', 'high-frequency-60fps', 'longform-landscape']
        .map(role => ({ role, kind: 'video', absolutePath: source })),
    } as ReferenceMediaFixture
    const fixture = new ReferenceProjectFixture(bridge, media)
    cleanup.push(() => fixture.dispose())
    await expect(fixture.createNestedSuperProject()).rejects.toThrow('snapshot import failed')
    await fixture.dispose()
    await expect(access(workspace)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
