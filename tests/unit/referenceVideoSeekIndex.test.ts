import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createFile } from 'mp4box'
import { expect, it } from 'vitest'
import { prepareReferenceVideoSeekIndex } from '../playwright/fixtures/referenceVideoSeekIndex'

function inspect(source: Buffer) {
  const file = createFile()
  file.appendBuffer(Object.assign(Uint8Array.from(source).buffer, { fileStart: 0 }))
  file.flush()
  return { file, track: file.getTrackById(file.getInfo().videoTracks[0].id) }
}

it('repairs only the reference seek table while preserving all encoded media and timing', async () => {
  const original = await readFile('fixtures/playwright-reference-project/media/x-rays-safe.mp4')
  const originalHash = createHash('sha256').update(original).digest('hex')
  const prepared = prepareReferenceVideoSeekIndex(original)
  const before = inspect(original)
  const after = inspect(prepared)
  const table = before.track.mdia.minf.stbl.stss!
  const start = table.start!
  const end = start + table.size

  expect(originalHash).toBe('0eebf268d7abfed511cdcbf04bb588b0d192bbe27751d8cf0c34d3734ec52be6')
  expect(createHash('sha256').update(original).digest('hex')).toBe(originalHash)
  expect(prepared.byteLength).toBe(original.byteLength)
  expect(prepared.subarray(0, start).equals(original.subarray(0, start))).toBe(true)
  expect(prepared.subarray(end).equals(original.subarray(end))).toBe(true)

  expect(table.sample_numbers).toHaveLength(47)
  expect(after.track.mdia.minf.stbl.stss!.sample_numbers).toHaveLength(16)
  expect(after.track.samples).toHaveLength(2728)
  expect(after.track.samples.map(({ offset, size, cts, dts, duration }) => (
    { offset, size, cts, dts, duration }
  ))).toEqual(before.track.samples.map(({ offset, size, cts, dts, duration }) => (
    { offset, size, cts, dts, duration }
  )))
  expect(after.file.getInfo().audioTracks).toEqual(before.file.getInfo().audioTracks)

  for (const number of after.track.mdia.minf.stbl.stss!.sample_numbers) {
    const sample = after.track.samples[number - 1]
    const nalTypes: number[] = []
    for (let offset = sample.offset; offset < sample.offset + sample.size;) {
      nalTypes.push(prepared[offset + 4] & 31)
      offset += 4 + prepared.readUInt32BE(offset)
    }
    expect(nalTypes).toContain(5)
  }
  // The final open-GOP recovery picture is retained, but no longer a seek entry.
  expect(before.track.samples[2665].is_sync).toBe(true)
  expect(after.track.samples[2665].is_sync).toBe(false)
})
