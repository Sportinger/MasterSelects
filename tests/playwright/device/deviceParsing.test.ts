import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { phoneClipAccessibleName } from '../../../src/components/mobileSkin/timeline/phoneTimelineGeometry'
import { deviceProjectName, isDeviceProjectName, PRODUCTION_BASE_URL, resolveDeviceEnv, ROUTE_LIMIT_BYTES, transportFor } from './deviceEnv'
import { pixelRecordingName } from './deviceFootage'
import {
  describeLoadReport, editorTabPaths, expectedTimelineFrames, judgeFrames, loadBudgetProblems, parseAdbDevices, parseClipLabel, parseExportSize,
  parseKeyguardShowing, parsePhoneTimeFrames, parsePortMappings, parseWakefulness, sanitizeBootMarks, sanitizeLoadReports, sourceSecondsAt,
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

  it('finds the existing editor tabs on the editor origin by path only, never with their query', () => {
    expect(editorTabPaths(['https://www.masterselects.com/m?project=secret', 'https://example.org/m', 'chrome://newtab/', 'not a url',
      'https://www.masterselects.com/editor#x'], PRODUCTION_BASE_URL)).toEqual(['/m', '/editor'])
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
    expect(describeLoadReport(report)).toBe('open ready (opfs): total 7200 ms · storage_open 300 · session_read 6400 · first frame 3500')
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
