import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceEnv } from './deviceEnv'
import { parseAdbDevices, parseKeyguardShowing, parsePortMappings, parseWakefulness } from './deviceParsing'

const run = promisify(execFile)

/**
 * The adb side of the real-device harness. It only reads device state, maps ports (forward for
 * DevTools, reverse for the PC's servers) and sends the wake key; it never changes a device
 * setting, never taps, types or swipes through adb, and removes only the port mappings it added.
 */
export class DeviceAdb {
  readonly serial: string
  private readonly adb: string
  private readonly added: Array<{ kind: 'forward' | 'reverse'; local: string }> = []
  private keepAwakeTimer: ReturnType<typeof setInterval> | null = null
  /** Lock-screen sightings of the keep-awake loop: a run that fails mid-way can say why. */
  readonly keepAwakeLog: Array<{ at: string; keyguard: boolean | null; error?: string }> = []

  private constructor(adb: string, serial: string) {
    this.adb = adb
    this.serial = serial
  }

  /** Picks the device (MASTERSELECTS_DEVICE_SERIAL, else the only one connected) and checks it is online. */
  static async connect(env: Pick<DeviceEnv, 'adb' | 'serial'>): Promise<DeviceAdb> {
    let output: string
    try {
      output = (await run(env.adb, ['devices', '-l'], { timeout: 15_000 })).stdout
    } catch (error) {
      throw new Error(`adb is not usable (${env.adb}): ${(error as Error).message}. Install platform-tools or set MASTERSELECTS_DEVICE_ADB.`)
    }
    const devices = parseAdbDevices(output)
    const online = devices.filter(device => device.state === 'device')
    if (env.serial) {
      const device = devices.find(item => item.serial === env.serial)
      if (!device) throw new Error(`adb does not see ${env.serial}. Pair and connect it first: adb pair <ip:pair-port>, then adb connect ${env.serial}.`)
      if (device.state !== 'device') throw new Error(`${env.serial} is "${device.state}" in adb (unauthorized: accept the debugging prompt on the phone; offline: reconnect wireless debugging).`)
      return new DeviceAdb(env.adb, env.serial)
    }
    if (online.length === 0) throw new Error('No phone is connected over adb. Enable wireless debugging, adb pair and adb connect, or set MASTERSELECTS_DEVICE_SERIAL.')
    if (online.length > 1) throw new Error(`Several devices are connected (${online.map(item => item.serial).join(', ')}); set MASTERSELECTS_DEVICE_SERIAL.`)
    return new DeviceAdb(env.adb, online[0].serial)
  }

  async exec(args: string[], timeout = 20_000): Promise<string> {
    const { stdout } = await run(this.adb, ['-s', this.serial, ...args], { timeout, maxBuffer: 16 * 1024 * 1024 })
    return stdout
  }

  shell(command: string, timeout = 20_000): Promise<string> {
    return this.exec(['shell', command], timeout)
  }

  async property(name: string): Promise<string> {
    return (await this.shell(`getprop ${name}`)).trim()
  }

  async keyguardShowing(): Promise<boolean | null> {
    // Android 16 can leave the window dump without a keyguard line; the KeyguardController in the
    // activity dump (`mKeyguardShowing=`) is the fallback before reporting "unknown".
    const fromWindow = parseKeyguardShowing(await this.shell('dumpsys window | grep -i keyguard', 20_000).catch(() => ''))
    if (fromWindow !== null) return fromWindow
    return parseKeyguardShowing(await this.shell('dumpsys activity activities | grep -i keyguard', 20_000).catch(() => ''))
  }

  async wakefulness(): Promise<string | null> {
    return parseWakefulness(await this.shell('dumpsys power | grep mWakefulness').catch(() => ''))
  }

  /** KEYCODE_WAKEUP only wakes a sleeping screen; on an awake one it does nothing (unlike POWER, it never toggles). */
  async wake(): Promise<void> {
    await this.shell('input keyevent KEYCODE_WAKEUP')
  }

  /**
   * Fails fast unless the screen is on and unlocked: a locked phone renders nothing and every
   * journey would time out. The wake key turns a dozing screen on first, so a phone that merely
   * dimmed passes; the lock screen itself is never touched (the owner unlocks it).
   */
  async assertUnlocked(): Promise<void> {
    if ((await this.wakefulness()) !== 'Awake') await this.wake()
    const keyguard = await this.keyguardShowing()
    if (keyguard === true) {
      throw new Error(`The phone ${this.serial} is locked (isKeyguardShowing=true). Unlock it and keep it on the home screen or in Chrome, then run again. The harness never unlocks or touches the lock screen.`)
    }
    if (keyguard === null) process.stdout.write(`[device] ${this.serial}: dumpsys did not report the keyguard state; continuing.\n`)
  }

  /** Sends the wake key every `intervalMs` while connected, and notes when the lock screen appears. */
  startKeepAwake(intervalMs: number): void {
    this.stopKeepAwake()
    this.keepAwakeTimer = setInterval(() => {
      void this.wake().then(() => this.keyguardShowing()).then(keyguard => {
        if (keyguard) this.keepAwakeLog.push({ at: new Date().toISOString(), keyguard })
      }, (error: unknown) => {
        this.keepAwakeLog.push({ at: new Date().toISOString(), keyguard: null, error: String(error).slice(0, 200) })
      })
    }, intervalMs)
    this.keepAwakeTimer.unref?.()
  }

  stopKeepAwake(): void {
    if (this.keepAwakeTimer) clearInterval(this.keepAwakeTimer)
    this.keepAwakeTimer = null
  }

  /** tcp:<port> on the PC to the phone's Chrome DevTools socket. Reuses an identical mapping; refuses a conflicting one. */
  async forwardDevTools(port: number): Promise<void> {
    const local = `tcp:${port}`, remote = 'localabstract:chrome_devtools_remote'
    const existing = parsePortMappings(await this.exec(['forward', '--list'])).find(item => item.local === local)
    if (existing && existing.remote === remote && existing.serial === this.serial) return
    if (existing) throw new Error(`PC port ${port} is already forwarded to ${existing.remote} on ${existing.serial ?? 'another device'}; set MASTERSELECTS_DEVICE_CDP_PORT to a free port.`)
    await this.exec(['forward', local, remote])
    this.added.push({ kind: 'forward', local })
  }

  /** tcp:<port> on the phone to the same port on the PC (a server on the PC reached as http://localhost:<port>). */
  async reverse(port: number): Promise<void> {
    const local = `tcp:${port}`
    const existing = parsePortMappings(await this.exec(['reverse', '--list']).catch(() => '')).find(item => item.local === local)
    if (existing && existing.remote === local) return
    if (existing) throw new Error(`Phone port ${port} is already reversed to ${existing.remote}; pick another port.`)
    await this.exec(['reverse', local, local])
    this.added.push({ kind: 'reverse', local })
  }

  /** Removes the port mappings this run added (and only those) and stops the keep-awake loop. */
  async release(): Promise<void> {
    this.stopKeepAwake()
    for (const mapping of this.added.splice(0).reverse()) {
      await this.exec([mapping.kind, '--remove', mapping.local]).catch(() => undefined)
    }
  }

  async describe(): Promise<{ serial: string; model: string; android: string; sdk: string; chrome: string }> {
    const [model, android, sdk, chromeDump] = await Promise.all([
      this.property('ro.product.model'), this.property('ro.build.version.release'), this.property('ro.build.version.sdk'),
      this.shell('dumpsys package com.android.chrome | grep -m1 versionName').catch(() => ''),
    ])
    return { serial: this.serial, model, android, sdk, chrome: /versionName=(\S+)/.exec(chromeDump)?.[1] ?? 'unknown' }
  }
}
