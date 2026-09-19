import { test, expect } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdir, mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { cleanupCase } from './cleanup'

test('Cleanup closes owned Chrome after a failure and preserves evidence @cleanup', async ({}, testInfo) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'masterselects-beta-chrome-'))
  const workspace = await mkdtemp(path.resolve('output/windows-beta/work-'))
  await mkdir(testInfo.outputDir, { recursive: true })
  await writeFile(testInfo.outputPath('browser.json'), JSON.stringify({ profile, workspace }))
  await mkdir(path.join(workspace, 'native-project-root'))
  const evidence = testInfo.outputPath('failure-evidence.txt')
  await writeFile(evidence, 'Keep this error evidence')
  let cleanup: unknown
  const failingRun = async () => {
    try {
      for (const folder of ['native-project-root', 'media']) {
        await mkdir(testInfo.outputPath(folder))
        await writeFile(testInfo.outputPath(folder, 'temporary.txt'), 'test owned')
      }
      const candidates = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
        .filter(Boolean).map(root => path.join(root!, 'Google/Chrome/Application/chrome.exe'))
      let executable: string | undefined
      for (const file of candidates) { try { await access(file); executable = file; break } catch { /* next */ } }
      if (!executable) throw new Error('Installed Chrome is required')
      const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0',
        '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' })
      child.unref()
      await expect.poll(async () => access(path.join(profile, 'DevToolsActivePort')).then(() => true, () => false)).toBe(true)
      throw new Error('Deliberate test failure')
    } finally { cleanup = await cleanupCase(testInfo.outputDir) }
  }
  await expect(failingRun()).rejects.toThrow('Deliberate test failure')
  expect(cleanup).toMatchObject({ verified: true })
  expect((cleanup as { stoppedProcessIds: number[] }).stoppedProcessIds.length).toBeGreaterThan(0)
  for (const folder of [profile, workspace, testInfo.outputPath('native-project-root'), testInfo.outputPath('media')]) {
    await expect(access(folder)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  expect(await readFile(evidence, 'utf8')).toBe('Keep this error evidence')
  await testInfo.attach('verified-cleanup', { body: JSON.stringify(cleanup), contentType: 'application/json' })
})

test('Cleanup rejects an ordinary directory without deleting its contents @cleanup', async ({}, testInfo) => {
  const ordinary = testInfo.outputPath('ordinary-directory')
  await mkdir(ordinary, { recursive: true })
  const sentinel = path.join(ordinary, 'keep.txt')
  await writeFile(sentinel, 'Must survive rejected cleanup')
  try {
  await expect(promisify(execFile)('powershell.exe', ['-NoProfile', '-File',
    path.resolve('tests/playwright/beta/cleanupWindowsTest.ps1'), '-ChromeProfile', ordinary],
  { windowsHide: true, timeout: 10_000 })).rejects.toThrow('explicitly owned beta-test Chrome profile')
  expect(await readFile(sentinel, 'utf8')).toBe('Must survive rejected cleanup')
  } finally { await unlink(sentinel); await rmdir(ordinary) }
})
