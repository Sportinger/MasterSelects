// When the phone skin starts the GPU engine. Normally at once, in parallel with the project
// restore (nothing in the restore waits for it). On an Android device whose WebGPU adapter request
// stalled on an earlier start, the engine starts only after the project is open: a stalled GPU
// process can also hold up the browser's own drawing, so the project must be on screen first.
// Desktop and healthy phones are unchanged.

import {
  browserIdentity,
  readAndroidAdapterMemory,
  type AndroidAdapterMemory,
} from '../../../engine/core/androidAdapterMemory';

export function isAndroidUserAgent(userAgent: string, platform = ''): boolean {
  return /android/i.test(`${platform} ${userAgent}`);
}

export function shouldDeferPhoneEngineStart(
  userAgent: string,
  memory: AndroidAdapterMemory | null,
  platform = '',
): boolean {
  if (!isAndroidUserAgent(userAgent, platform) || !memory) return false;
  if (memory.browser !== browserIdentity(userAgent)) return false;
  return memory.coreTimeouts > 0 || memory.compatibilityTimeouts > 0;
}

/** Reads the browser and the stored adapter memory; false wherever either is unavailable. */
export function readPhoneEngineStartDeferral(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    return shouldDeferPhoneEngineStart(navigator.userAgent || '', readAndroidAdapterMemory(), navigator.platform || '');
  } catch {
    return false;
  }
}
