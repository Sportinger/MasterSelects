import { phoneFootage, type PhoneFootage } from '../fixtures/phoneFootage.ts'
import { PHONE_FOOTAGE_PROFILES, type PhoneFootageProfileId } from '../fixtures/phoneFootageProfiles.ts'

/**
 * The phone footage the journeys import, from the footage fixture (fixtures/phoneFootage.ts): generated
 * on the PC with ffmpeg and kept in the shared test media store (fixtures/testMediaStore.ts:
 * local cache plus the optional remote; MASTERSELECTS_PHONE_FOOTAGE_DIR overrides the local
 * folder), never real recordings.
 */
export type { PhoneFootage }

export function isPhoneFootageProfile(id: string): id is PhoneFootageProfileId {
  return Object.hasOwn(PHONE_FOOTAGE_PROFILES, id)
}

export async function ensureDeviceFootage(profile: PhoneFootageProfileId, log: (line: string) => void): Promise<PhoneFootage> {
  const footage = await phoneFootage(profile, { log })
  log(`${profile}: ${(footage.bytes / 1e6).toFixed(1)} MB, ${footage.model.pts.length} frames, ${footage.generatedMs ? `generated in ${Math.round(footage.generatedMs / 1000)} s` : 'from the cache'}`)
  return footage
}

/** Container MIME type of a footage file, as the phone's picker reports it. */
export function footageContentType(file: string): string {
  return /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4'
}

/**
 * A file name like the Pixel camera's (PXL_YYYYMMDD_HHMMSSmmm.mp4), so the editor sees the name a
 * real import carries. Generated from the run time; it names no real recording.
 */
export function pixelRecordingName(file: string, now = new Date()): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}${pad(now.getUTCMilliseconds(), 3)}`
  return `PXL_${stamp}${/\.mov$/i.test(file) ? '.mov' : '.mp4'}`
}
