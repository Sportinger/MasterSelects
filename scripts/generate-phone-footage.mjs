#!/usr/bin/env node
/**
 * Generates the synthetic phone footage fixtures (tests/playwright/fixtures/phoneFootage.ts)
 * into the shared test media cache (phone-footage/ under MASTERSELECTS_TEST_MEDIA_DIR, default
 * ~/.cache/masterselects-test-media; fetched from or uploaded to the test media remote when one
 * is configured, see tests/playwright/README.md "Test media cache") and verifies each file against its
 * expectation model with ffprobe (timestamps, codec, timescale, rotation) and,
 * with --frames, by decoding every frame and reading its frame code.
 *
 *   node scripts/generate-phone-footage.mjs                 # every short profile (15 s each)
 *   node scripts/generate-phone-footage.mjs android-vfr iphone-hevc-2997
 *   node scripts/generate-phone-footage.mjs long-10min --frames
 *   node scripts/generate-phone-footage.mjs long-10min multi-gb --keep-segments   # multi-gb reuses long-10min's segments
 *   node scripts/generate-phone-footage.mjs multi-gb        # > 2.5 GB, needs ~6 GB free (checked before it starts)
 *   node scripts/generate-phone-footage.mjs --small all     # unit-test sizes
 *   node scripts/generate-phone-footage.mjs --list
 *
 * MASTERSELECTS_PHONE_FOOTAGE_DIR moves the local footage folder to another disk. Nothing here
 * touches a phone or personal media; every file is generated.
 */
import { registerHooks } from 'node:module'

// The Playwright fixtures use extensionless relative imports (bundler resolution);
// Node's type stripping needs the file name, so try `.ts` when a relative import has none.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
})

const { phoneFootage, phoneFootageProfile } = await import('../tests/playwright/fixtures/phoneFootage.ts')
const { PHONE_FOOTAGE_PROFILES, intervalStats } = await import('../tests/playwright/fixtures/phoneFootageProfiles.ts')
const { probeFootage, checkFootageProbe, checkFootageFrames, topLevelBoxes } = await import('../tests/playwright/assertions/phoneFootageOracle.ts')

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const size = flag('--small') ? 'small' : 'full'
const all = Object.keys(PHONE_FOOTAGE_PROFILES)
const short = all.filter(id => !PHONE_FOOTAGE_PROFILES[id].segmentSeconds)
const named = args.filter(arg => !arg.startsWith('--'))

if (flag('--list')) {
  for (const id of all) console.log(`${id.padEnd(22)} ${PHONE_FOOTAGE_PROFILES[id].description}`)
  process.exit(0)
}
const ids = named.includes('all') ? all : named.length ? named : short
for (const id of ids) if (!all.includes(id)) { console.error(`unknown profile ${id}; --list shows them`); process.exit(2) }

let failed = 0
const uploads = []
for (const id of ids) {
  const profile = phoneFootageProfile(id, size)
  const started = Date.now()
  const footage = await phoneFootage(id, { size, keepSegments: flag('--keep-segments'), log: line => console.log(`  ${line}`) })
  if (footage.upload) uploads.push(footage.upload)
  const segmented = Boolean(profile.segmentSeconds)
  const probe = await probeFootage(footage.path, { source: segmented || flag('--packets') ? 'packets' : 'frames' })
  const report = checkFootageProbe(footage.model, probe)
  const boxes = (await topLevelBoxes(footage.path)).map(box => box.type)
  const moovLast = boxes.indexOf('moov') > boxes.indexOf('mdat')
  const stats = intervalStats(footage.model)
  const frames = flag('--frames') ? await checkFootageFrames(footage.path, footage.model) : null
  const ok = report.ok && moovLast && (frames?.ok ?? true)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} (${size}) ${footage.path}`)
  console.log(`     ${(footage.bytes / 1e6).toFixed(1)} MB, ${footage.model.pts.length} frames, ${(footage.model.endTicks / profile.timescale).toFixed(3)} s, `
    + `${footage.generatedMs ? `generated in ${(footage.generatedMs / 1000).toFixed(1)} s` : 'cached'}, verified in ${((Date.now() - started - footage.generatedMs) / 1000).toFixed(1)} s`)
  console.log(`     ${probe.video.codec}/${probe.video.codecTag} tb ${probe.video.timeBase} ${probe.video.width}x${probe.video.height} rot ${probe.video.rotation}, `
    + `intervals ${stats.minMs.toFixed(2)}-${stats.maxMs.toFixed(2)} ms, boxes ${boxes.join(' ')}, pts ${probe.source}: ${report.ok ? 'exact' : 'MISMATCH'}`
    + `${frames ? `, frame codes: ${frames.ok ? 'all correct' : 'WRONG'}` : ''}`)
  for (const problem of [...report.problems, ...(frames?.problems ?? []), ...(moovLast ? [] : ['moov is not after mdat'])]) console.log(`     - ${problem}`)
}
// Seeding: wait until every file that is not on the test media remote yet has arrived there.
if (uploads.length) {
  console.log('checking the test media remote for files it does not have yet')
  const arrived = (await Promise.all(uploads)).filter(Boolean).length
  console.log(`${arrived} file(s) uploaded to the test media remote`)
}
process.exit(failed ? 1 : 0)
