import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { phoneClipAccessibleName } from '../../../src/components/mobileSkin/timeline/phoneTimelineGeometry'
import { deviceProjectName, isDeviceProjectName, PRODUCTION_BASE_URL, resolveDeviceEnv, ROUTE_LIMIT_BYTES, transportFor } from './deviceEnv'
import { pixelRecordingName } from './deviceFootage'
import {
  actionPhases, describeActionPhases, sanitizeMediaImportReports, type ActionEvent,
  describeLoadReport, editorTabPaths, expectedTimelineFrames, judgeFrames, loadBudgetProblems, parseAdbDevices, parseClipLabel, parseExportSize,
  parseKeyguardShowing, parsePhoneTimeFrames, parsePortMappings, parseWakefulness, planDeviceTabs, hasDeviceTabMarker, deviceTabURL, PARKED_DEVICE_TAB_URL, sanitizeBootMarks, sanitizeLoadReports, seekPathPictures, sourceSecondsAt, transportMs,
} from './deviceParsing'

// Pure parts of the real-device harness (tests/playwright/device). Nothing here touches adb or a phone.

describe('adb output', () => {
  it('lists devices with their state and model, wireless serials included', () => {
    const output = 'List of devices attached\n'
      + '192.168.178.40:37115  device product:frankel model:Pixel_10_Pro device:frankel transport_id:3\n'
      + 'adb-4A1B2C-xyz._adb-tls-connect._tcp  unauthorized transport_id:4\n'
      + '* daemon started successfully\n\n'
    expect(parseAdbDevices(output)).toEqual([
      { serial: '192.168.178.40:37115', state: 'device', model: 'Pixel_10_Pro' },
      { serial: 'adb-4A1B2C-xyz._adb-tls-connect._tcp', state: 'unauthorized' },
    ])
  })

  it('reads the lock screen and wakefulness, null when absent', () => {
    expect(parseKeyguardShowing('  mKeyguardOccluded=false\n    isKeyguardShowing=true mShowingDream=false')).toBe(true)
    expect(parseKeyguardShowing('isKeyguardShowing=false')).toBe(false)
    expect(parseKeyguardShowing('mShowingLockscreen=true')).toBe(true)
    expect(parseKeyguardShowing('nothing here')).toBeNull()
    expect(parseWakefulness('  mWakefulness=Dozing\n  mWakefulnessChanging=false')).toBe('Dozing')
    expect(parseWakefulness('')).toBeNull()
  })

  it('parses forward and reverse listings', () => {
    expect(parsePortMappings('192.168.178.40:37115 tcp:9333 localabstract:chrome_devtools_remote\n')).toEqual([
      { serial: '192.168.178.40:37115', local: 'tcp:9333', remote: 'localabstract:chrome_devtools_remote' },
    ])
    expect(parsePortMappings('tcp:8099 tcp:8099\n')).toEqual([{ local: 'tcp:8099', remote: 'tcp:8099' }])
    expect(parsePortMappings('')).toEqual([])
  })

  it('finds the owner tabs on the editor origin by path only, never with their query', () => {
    expect(editorTabPaths(['https://www.masterselects.com/m?project=secret', 'https://example.org/m', 'chrome://newtab/', 'not a url',
      'https://www.masterselects.com/editor#x'], PRODUCTION_BASE_URL)).toEqual(['/m', '/editor'])
  })

  it('marks the test tab in its URL fragment, which survives Chrome discarding and reloading the tab', () => {
    expect(deviceTabURL('https://www.masterselects.com/')).toBe('https://www.masterselects.com/m#masterselects-device-test')
    expect(hasDeviceTabMarker(deviceTabURL(PRODUCTION_BASE_URL))).toBe(true)
    expect(hasDeviceTabMarker(PARKED_DEVICE_TAB_URL)).toBe(true)
    expect(hasDeviceTabMarker('https://www.masterselects.com/m')).toBe(false)
    expect(hasDeviceTabMarker('https://www.masterselects.com/m#other')).toBe(false)
    expect(hasDeviceTabMarker('not a url')).toBe(false)
  })

  it('reuses its own marked tab, parks further marked editor tabs and reports unmarked editor tabs as the owner\'s', () => {
    const base = PRODUCTION_BASE_URL
    expect(planDeviceTabs([], base)).toEqual({ reuse: null, park: [], ownerEditorPaths: [] })
    expect(planDeviceTabs([{ url: 'https://example.org/', marked: false }, { url: `${base}/m`, marked: true }], base))
      .toEqual({ reuse: 1, park: [], ownerEditorPaths: [] })
    // A parked about:blank harness tab is used only when no marked tab shows the editor.
    expect(planDeviceTabs([{ url: PARKED_DEVICE_TAB_URL, marked: true }, { url: `${base}/m`, marked: true }, { url: `${base}/m?x=1`, marked: true }], base))
      .toEqual({ reuse: 1, park: [2], ownerEditorPaths: [] })
    expect(planDeviceTabs([{ url: PARKED_DEVICE_TAB_URL, marked: true }], base)).toEqual({ reuse: 0, park: [], ownerEditorPaths: [] })
    expect(planDeviceTabs([{ url: `${base}/editor?project=secret`, marked: false }, { url: `${base}/m`, marked: true }], base))
      .toEqual({ reuse: 1, park: [], ownerEditorPaths: ['/editor'] })
  })
})

describe('phone UI texts', () => {
  it('reads the transport time as frames (mm:ss.ff counts frames, not hundredths)', () => {
    expect(parsePhoneTimeFrames('00:07.15', 30)).toBe(225)
    expect(parsePhoneTimeFrames('01:00.00', 30)).toBe(1800)
    expect(parsePhoneTimeFrames('00:00.29 / 00:15.00', 30)).toBe(29)
    expect(parsePhoneTimeFrames('7.5 s', 30)).toBeNull()
  })

  it('reads the clip tile name the phone renders, also past one minute', () => {
    const label = phoneClipAccessibleName({ name: 'PXL_20261028_101500123.mp4, part', startTime: 7.5, duration: 62.25 })
    expect(parseClipLabel(label)).toEqual({ name: 'PXL_20261028_101500123.mp4, part', start: 7.5, duration: 62.25 })
    expect(parseClipLabel('no label')).toBeNull()
  })

  it('reads the export size from the summary', () => {
    expect(parseExportSize('MP4 · 1080 × 1920 · 30 fps · 15.0 s')).toEqual({ width: 1080, height: 1920 })
    expect(parseExportSize('Nothing to export')).toBeNull()
  })
})

describe('load telemetry', () => {
  it('keeps only machine fields of the boot marks; a detail that could be a project name is dropped', () => {
    const marks = sanitizeBootMarks({ marks: [
      { phase: 'boot-start', at: 12.4 }, { phase: 'repository-open', at: 340.6, detail: 'restored' },
      { phase: 'stores-hydrated', at: 900, detail: 'Hochzeit Anna & Ben, Folder /storage/emulated/0' }, { phase: 'x', at: 'late' },
    ] })
    expect(marks).toEqual([{ phase: 'boot-start', atMs: 12 }, { phase: 'repository-open', atMs: 341, detail: 'restored' }, { phase: 'stores-hydrated', atMs: 900 }])
    expect(sanitizeBootMarks(null)).toEqual([])
  })

  it('reduces load reports to the documented fields and judges them against the budget', () => {
    const [report] = sanitizeLoadReports([{ kind: 'open', outcome: 'ready', storage: 'opfs', totalMs: 7200, phases: { storage_open: 300, session_read: 6400, 'Bad Phase': 5 },
      firstFrameMs: 3500, mainThread: { longTaskMs: 900, pageHidden: false }, location: '/secret/path', projectName: 'Secret' }])
    expect(report).toEqual({ kind: 'open', outcome: 'ready', storage: 'opfs', totalMs: 7200, phases: { storage_open: 300, session_read: 6400 }, firstFrameMs: 3500,
      mainThread: { longTaskMs: 900, longTaskMaxMs: undefined, longTaskCount: undefined, frameGapMaxMs: undefined, pageHidden: false } })
    expect(JSON.stringify(report)).not.toMatch(/secret/i)
    expect(loadBudgetProblems(report, { phaseMs: 3000, totalMs: 6000, firstFrameMs: 3000 })).toEqual([
      'phase session_read took 6400 ms (budget 3000)', 'total 7200 ms (budget 6000)', 'first frame after 3500 ms (budget 3000)',
    ])
    expect(describeLoadReport(report)).toBe('open ready (opfs): total 7200 ms · storage_open 300 · session_read 6400 · first frame 3500 · long tasks 900')
  })

  it('reports the storage worker start (its script over the adb link) and judges storage_open and the total without it', () => {
    // Pixel run 14: the worker script fetch stalled for ~14 s; the storage open itself took ~140 ms.
    const [report] = sanitizeLoadReports([{ kind: 'create', outcome: 'ready', storage: 'opfs', totalMs: 14098, phases: { storage_open: 13927, views: 99 }, workerStartMs: 13790.4 }])
    expect(report.workerStartMs).toBe(13790)
    expect(transportMs(report)).toBe(13790)
    expect(loadBudgetProblems(report, { phaseMs: 3000, totalMs: 6000, firstFrameMs: 3000 })).toEqual([])
    expect(describeLoadReport(report)).toBe('create ready (opfs): total 14098 ms · storage_open 13927 · views 99 · storage worker start 13790')
    // A slow open after a quick worker start is still judged.
    const [slow] = sanitizeLoadReports([{ kind: 'open', outcome: 'ready', storage: 'opfs', totalMs: 9000, phases: { storage_open: 8500 }, workerStartMs: 200 }])
    expect(loadBudgetProblems(slow, { phaseMs: 3000, totalMs: 6000, firstFrameMs: 3000 })).toEqual([
      'phase storage_open took 8300 ms after the worker start (budget 3000)', 'total 8800 ms without the worker start (budget 6000)',
    ])
    // Builds without the field judge as before.
    expect(transportMs(sanitizeLoadReports([{ kind: 'open', outcome: 'ready', totalMs: 10, phases: { storage_open: 5 } }])[0]!)).toBe(0)
  })
})

describe('frame expectations', () => {
  const segments = [{ startFrame: 0, endFrame: 225, sourceStartSeconds: 0 }, { startFrame: 255, endFrame: 400, sourceStartSeconds: 8.5 }]

  it('maps timeline frames to source times, gaps to null', () => {
    expect(sourceSecondsAt(segments, 224, 30)).toBeCloseTo(224 / 30, 9)
    expect(sourceSecondsAt(segments, 230, 30)).toBeNull()
    expect(sourceSecondsAt(segments, 256, 30)).toBeCloseTo(8.5 + 1 / 30, 9)
    const frames = expectedTimelineFrames(segments, 260, 30, seconds => Math.floor(seconds * 30 + 1e-6))
    expect(frames.slice(223, 227)).toEqual([223, 224, null, null])
    expect(frames.slice(254, 257)).toEqual([null, 255, 256])
  })

  it('lets a seek show only the pictures strictly between start and target, none on a cut and no neighbours', () => {
    const pictureAt = (frame: number) => expectedTimelineFrames(segments, 400, 30, seconds => Math.floor(seconds * 30 + 1e-6))[frame]
    // Within one segment: the frames stepped through, not the start or the target, no ±1.
    expect([...seekPathPictures(segments, 100, 104, pictureAt)]).toEqual([101, 102, 103])
    expect([...seekPathPictures(segments, 104, 100, pictureAt)]).toEqual([101, 102, 103])
    // Across the gap: segment ends (224, 255 on the timeline) are cut frames, the gap shows nothing.
    const across = seekPathPictures(segments, 220, 260, pictureAt)
    expect(across.has(224)).toBe(false)
    expect(across.has(255)).toBe(false)
    expect([...across].toSorted((a, b) => a - b)).toEqual([221, 222, 223, 256, 257, 258, 259])
    // Adjacent frames: nothing in between.
    expect(seekPathPictures(segments, 152, 153, pictureAt).size).toBe(0)
    // A step whose rounding policy decides between two pictures lets both pass, never on a cut.
    const either = (frame: number) => frame === 102 || frame === 224 ? [pictureAt(frame)!, pictureAt(frame)! + 1] : pictureAt(frame)
    expect([...seekPathPictures(segments, 100, 103, either)].toSorted((a, b) => a - b)).toEqual([101, 102, 103])
    const atCut = seekPathPictures(segments, 220, 226, either)
    expect(atCut.has(224) || atCut.has(225)).toBe(false)
  })

  it('fails wrong frames but only reports a one-frame difference at a frame the rounding policy decides', () => {
    const verdict = judgeFrames([1, 2, 3, null, 5], [1, 3, 4, null, 7], index => index === 1)
    expect(verdict.policy).toEqual(['#1: got 3, expected 2'])
    expect(verdict.failures).toEqual(['#2: got 4, expected 3', '#4: got 7, expected 5'])
    expect(judgeFrames([1, 2], [1], () => false).failures).toEqual(['expected 2 frames, got 1'])
    expect(judgeFrames([null], [4], () => true).failures).toEqual(['#0: got 4, expected none (gap)'])
  })
})

describe('device settings', () => {
  it('defaults to production, the tmp output folder and the auto transport, and is off without MASTERSELECTS_DEVICE=1', () => {
    const env = resolveDeviceEnv({})
    expect(env).toMatchObject({ enabled: false, baseURL: PRODUCTION_BASE_URL, cdpPort: 9333, transport: 'auto', reversePorts: [], allowEditorTabs: false,
      outputDir: path.join(os.tmpdir(), 'masterselects-device'), footageProfile: 'android-h264' })
    expect(resolveDeviceEnv({ MASTERSELECTS_DEVICE: '1' }).enabled).toBe(true)
    expect(resolveDeviceEnv({ MASTERSELECTS_DEVICE: 'true' }).enabled).toBe(false)
  })

  it('reverses the port of a dev server on the PC that the phone reaches as localhost', () => {
    const env = resolveDeviceEnv({ MASTERSELECTS_DEVICE_BASE_URL: 'https://localhost:5173/', MASTERSELECTS_DEVICE_REVERSE_PORTS: '8787, 8788' })
    expect(env.baseURL).toBe('https://localhost:5173')
    expect(env.reversePorts).toEqual([8787, 8788, 5173])
    expect(resolveDeviceEnv({ MASTERSELECTS_DEVICE_BASE_URL: 'https://192.168.178.20:5173' }).reversePorts).toEqual([])
  })

  it('rejects bad values with the variable name', () => {
    expect(() => resolveDeviceEnv({ MASTERSELECTS_DEVICE_CDP_PORT: 'abc' })).toThrow(/MASTERSELECTS_DEVICE_CDP_PORT/)
    expect(() => resolveDeviceEnv({ MASTERSELECTS_DEVICE_MEDIA_TRANSPORT: 'usb' })).toThrow(/auto, route or reverse/)
    expect(() => resolveDeviceEnv({ MASTERSELECTS_DEVICE_BASE_URL: 'not a url' })).toThrow(/not a URL/)
  })

  it('serves small files through a route and large ones over adb reverse', () => {
    expect(transportFor({ transport: 'auto' }, ROUTE_LIMIT_BYTES)).toBe('route')
    expect(transportFor({ transport: 'auto' }, ROUTE_LIMIT_BYTES + 1)).toBe('reverse')
    expect(transportFor({ transport: 'route' }, 5e9)).toBe('route')
  })

  it('names test projects so they are recognisable, and media like a Pixel recording', () => {
    const name = deviceProjectName(new Date('2026-10-28T11:22:38Z'))
    expect(name).toBe('Device test 20261028 112238')
    expect(isDeviceProjectName(name)).toBe(true)
    expect(isDeviceProjectName('Hochzeit Anna')).toBe(false)
    expect(pixelRecordingName('/tmp/x/phone-r1-android-h264.mp4', new Date('2026-10-28T10:15:00.123Z'))).toBe('PXL_20261028_101500123.mp4')
    expect(pixelRecordingName('/tmp/x/iphone.mov', new Date('2026-10-28T10:15:00.123Z'))).toBe('PXL_20261028_101500123.mov')
  })
})

describe('page-side action phases', () => {
  const events: ActionEvent[] = [
    { atMs: 100, kind: 'click', id: 'phone-create-project' },
    { atMs: 1000, kind: 'down', id: 'phone-create-project' },
    { atMs: 1060, kind: 'click', id: 'phone-create-project' },
    { atMs: 1066, kind: 'show', id: 'phone-project-loading' },
    { atMs: 1380, kind: 'hide', id: 'phone-home' },
  ]
  const ends = { loading: { kind: 'show' as const, id: 'phone-project-loading' }, home: { kind: 'hide' as const, id: 'phone-home' } }

  it('splits a tap into page phases and attributes the rest of the wall time to the DevTools transport', () => {
    const result = actionPhases(events, 'phone-create-project', ends, 15_400, 900)
    expect(result).toEqual({ phases: { tap: 60, loading: 6, home: 320 }, pageMs: 380, transportMs: 15_020 })
    expect(describeActionPhases(result)).toBe('page 380 ms (tap 60 · loading 6 · home 320) · DevTools transport 15020 ms')
  })

  it('reports no page time when the click or an end was not seen', () => {
    expect(actionPhases([], 'phone-create-project', ends, 500)).toEqual({ phases: {}, pageMs: null, transportMs: null })
    expect(actionPhases(events.slice(0, 4), 'phone-create-project', ends, 500, 900)).toEqual({ phases: { tap: 60, loading: 6 }, pageMs: null, transportMs: null })
  })

  it('passes only machine fields of the media import reports', () => {
    expect(sanitizeMediaImportReports([
      { kind: 'phone-add', mediaType: 'video/mp4', bytes: 30e6, totalMs: 4100.4, outcome: 'ok', startedAt: 5, phases: [{ phase: 'import', ms: 3900.2 }, { phase: 'My Video.mp4', ms: 1 }] },
      { kind: 'PXL 2026 secret.mp4', bytes: 1, totalMs: 1 },
      'junk',
    ])).toEqual([{ kind: 'phone-add', mediaType: 'video/mp4', bytes: 30e6, totalMs: 4100, outcome: 'ok', phases: [{ phase: 'import', ms: 3900 }] }])
    expect(sanitizeMediaImportReports(null)).toEqual([])
  })
})
