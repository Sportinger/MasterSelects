import { Buffer } from 'node:buffer'
import { createFile } from 'mp4box'

/**
 * The X-Rays reference MP4 lists open-GOP recovery pictures as sync samples.
 * Chrome's HTML decoder fails when seeking into its final GOP without the
 * earlier reference pictures. Use IDR entry points in the disposable copy;
 * leave every encoded sample, timestamp, and chunk offset unchanged.
 */
export function prepareReferenceVideoSeekIndex(source: Buffer): Buffer {
  const file = createFile()
  file.onError = (error) => { throw new Error(String(error)) }
  file.appendBuffer(Object.assign(Uint8Array.from(source).buffer, { fileStart: 0 }))
  file.flush()
  const video = file.getInfo().videoTracks[0]
  if (!video?.codec.startsWith('avc1')) throw new Error('Expected the AVC reference video')
  const track = file.getTrackById(video.id)
  const table = track.mdia.minf.stbl.stss
  const avcC = (track.mdia.minf.stbl.stsd.entries[0] as {
    avcC?: { lengthSizeMinusOne: number }
  }).avcC
  if (!table || table.start === undefined || avcC?.lengthSizeMinusOne !== 3) {
    throw new Error('Unexpected reference video seek index')
  }

  const idrSamples = table.sample_numbers.filter((sampleNumber) => {
    const sample = track.samples[sampleNumber - 1]
    if (!sample) throw new Error('Reference seek index points outside the sample table')
    const end = sample.offset + sample.size
    let offset = sample.offset
    let hasIdr = false
    while (offset + 4 < end) {
      const length = source.readUInt32BE(offset)
      if (length === 0 || offset + 4 + length > end) {
        throw new Error('Invalid NAL length in reference sync sample')
      }
      hasIdr ||= (source[offset + 4] & 31) === 5
      offset += 4 + length
    }
    if (offset !== end) throw new Error('Incomplete reference sync sample')
    return hasIdr
  })
  const size = 16 + idrSamples.length * 4
  const padding = table.size - size
  if (idrSamples[0] !== 1 || padding < 8) {
    throw new Error('Expected open-GOP entries in the reference seek index')
  }

  const result = Buffer.from(source)
  result.writeUInt32BE(size, table.start)
  result.writeUInt32BE(idrSamples.length, table.start + 12)
  idrSamples.forEach((sampleNumber, index) => {
    result.writeUInt32BE(sampleNumber, table.start! + 16 + index * 4)
  })
  // A free box preserves all parent sizes and media offsets after shrinking stss.
  const freeStart = table.start + size
  result.fill(0, freeStart, table.start + table.size)
  result.writeUInt32BE(padding, freeStart)
  result.write('free', freeStart + 4, 'ascii')
  return result
}
