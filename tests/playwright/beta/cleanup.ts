import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { FullConfig } from '@playwright/test'

const execute = promisify(execFile)
export async function cleanupCase(directory: string) {
  const { profile, workspace } = JSON.parse(await readFile(path.join(directory, 'browser.json'), 'utf8')) as { profile: string; workspace?: string }
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.resolve('tests/playwright/beta/cleanupWindowsTest.ps1'), '-ChromeProfile', profile,
    '-CaseDirectory', directory, ...(workspace ? ['-Workspace', workspace] : [])], { windowsHide: true, timeout: 45_000 })
  const result: unknown = JSON.parse(stdout)
  await writeFile(path.join(directory, 'cleanup.json'), JSON.stringify(result, null, 2))
  return result
}

// Also runs when a Playwright worker crashes before its fixture teardown.
export default async function cleanupRun(config: FullConfig) {
  const directory = config.projects[0].outputDir
  const cases = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const failures: unknown[] = []
  for (const entry of cases) {
    if (!entry.isDirectory()) continue
    const caseDirectory = path.join(directory, entry.name)
    try { await readFile(path.join(caseDirectory, 'browser.json')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    try { await cleanupCase(caseDirectory) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Some beta-test resources could not be cleaned up')
}
