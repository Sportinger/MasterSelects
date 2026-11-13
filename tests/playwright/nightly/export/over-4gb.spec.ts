import { chromium, expect, test } from '@playwright/test'
import { chromeLaunchArgs } from '../../config/runtimeProfile'

/**
 * Production 3.3.0: "ArrayBuffer exceeded maximum size of 4294967296 bytes" after a full encode of about
 * 30 minutes, three runs in a row. Encoding 4 GB for real takes too long for a journey, so this feeds
 * the real muxer with large packets in the real browser. Oracle: the file on browser storage is larger than
 * 4 GB, and MediaBunny reads every packet back from the Blob the export hands over.
 */
test('an export above 4 GB is written to browser storage and reads back complete @nightly @module:export @case:export.over-4gb', async ({ baseURL }, testInfo) => {
  test.setTimeout(420_000)
  const headless = process.env.MASTERSELECTS_E2E_HEADLESS === '1'
  // A normal profile: Playwright's usual context is ephemeral and, like a private window, allows about 1 GB.
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chrome', headless, args: chromeLaunchArgs(process.platform, headless),
  })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(new URL('/editor', baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const result = await page.evaluate(async () => {
    const dev = (path: string) => import(/* @vite-ignore */ path)
    const { openExportDiskSpill } = await dev('/src/engine/export/exportDiskSpill.ts')
    const { MediaBunnyMuxerAdapter } = await dev('/src/engine/export/MediaBunnyMuxerAdapter.ts')
    const mediabunny = await dev('/node_modules/.vite/deps/mediabunny.js')
    const packetBytes = 64 * 1024 * 1024
    const target = 4.2 * 1024 ** 3
    const packets = Math.ceil(target / packetBytes)
    const spill = await openExportDiskSpill(target)
    if (!spill) throw new Error('the export did not get a disk target')
    const muxer = new MediaBunnyMuxerAdapter({ container: 'mp4', videoCodec: 'h264', fps: 30, hasAudio: false, audioCodec: 'aac', spill })
    const data = new Uint8Array(packetBytes)
    const meta = { decoderConfig: { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080,
      description: new Uint8Array([1, 100, 0, 40, 255, 225, 0, 4, 103, 100, 0, 40, 1, 0, 4, 104, 235, 227, 203]) } }
    let peakQueued = 0
    for (let index = 0; index < packets; index += 1) {
      muxer.addVideoChunk(new EncodedVideoChunk({ type: 'key', timestamp: Math.round(index * 1e6 / 30), duration: Math.round(1e6 / 30), data }), meta)
      // Like the encoder wrapper: the next frame waits while the disk is behind, so memory stays bounded.
      peakQueued = Math.max(peakQueued, (muxer as unknown as { queue: unknown[] }).queue.length)
      await muxer.waitForDiskCapacity()
      if (muxer.failure) throw muxer.failure
    }
    await muxer.finalize()
    const blob: Blob = await muxer.getBlob('video/mp4')
    const input = new mediabunny.Input({ formats: [mediabunny.MP4], source: new mediabunny.BlobSource(blob) })
    const track = await input.getPrimaryVideoTrack()
    const stats = await track.computePacketStats()
    const last = await new mediabunny.EncodedPacketSink(track).getPacket((packets - 1) / 30)
    input.dispose()
    return { size: blob.size, packets, peakQueued, readPackets: stats.packetCount, lastPacketBytes: last?.byteLength ?? 0 }
  })
  await context.close()
  expect(result.size).toBeGreaterThan(4 * 1024 ** 3)
  expect(result.readPackets).toBe(result.packets)
  expect(result.lastPacketBytes).toBe(64 * 1024 * 1024)
  expect(result.peakQueued, 'packets must leave memory while encoding').toBeLessThan(8)
})
