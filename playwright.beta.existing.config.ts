import { defineConfig } from '@playwright/test'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
if (process.env.MS_BETA_EXISTING !== '1') throw new Error('MS_BETA_EXISTING=1 required')
const root = process.env.MS_BETA_EXISTING_OUTPUT
if (!root || !path.isAbsolute(root)) throw new Error('Explicit fresh absolute evidence directory required (use E:)')
// The controller exclusively reserves a fresh directory once. Playwright workers
// reload this module and must accept that exact reservation, not reject their own output.
const reservation = readFileSync(path.join(root, 'reservation.json'))
const reservationPin = process.env.MS_BETA_RESERVATION_SHA256
if (!/^[a-f0-9]{64}$/.test(reservationPin || '') ||
  createHash('sha256').update(reservation).digest('hex') !== reservationPin) throw new Error('Exact run reservation required')
const owner = JSON.parse(reservation.toString('utf8'))
if (owner.schema !== 'mstest-existing-run/v1' || owner.output !== path.resolve(root) ||
  !path.isAbsolute(owner.localArtifactsRoot || '') || owner.localArtifactsRoot !== process.env.MS_BETA_LOCAL_ARTIFACTS ||
  owner.targetId !== process.env.MS_BETA_TARGET_ID ||
  owner.packageManifestSha256 !== process.env.MS_BETA_PACKAGE_SHA256) throw new Error('Run reservation binding mismatch')
const qualification = process.env.MS_BETA_QUALIFICATION
if (qualification && !['boundary', 'negative'].includes(qualification)) throw new Error('Unknown qualification mode')
export default defineConfig({
  testDir: './tests/playwright/beta',
  testMatch: qualification === 'boundary' ? ['existingBoundaryQualification.spec.ts']
    : qualification === 'negative' ? ['existingLifecycleNegative.spec.ts']
    : ['edit-mask-export.spec.ts', 'readiness.spec.ts', 'temporalOracle.spec.ts', 'existingLifecycle.spec.ts'],
  outputDir: path.join(root, 'artifacts'), workers: 1, retries: 0, fullyParallel: false,
  timeout: 180_000, expect: { timeout: 15_000 }, forbidOnly: true, maxFailures: 1,
  reporter: [['list'], ['json', { outputFile: path.join(root, 'results.json') }]],
  use: { baseURL: 'http://127.0.0.1:4189', actionTimeout: 15_000, trace: 'off', video: 'off' },
  projects: [{ name: 'existing-mstest-proposed' }],
})
