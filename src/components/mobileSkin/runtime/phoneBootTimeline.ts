// Always-on timings of the phone boot phases. Each phase is recorded once per page load with its
// time since navigation start, logged at info level, and kept on window.__MS_PHONE_BOOT__ so a
// real-device report (remote DevTools, bridge getLogs) shows where the time went. Once the boot has
// settled, a slow one (any phase later than SLOW_BOOT_MS) or one without a GPU files one warning
// with the whole timeline, which reaches the diagnostics buffer even when info logging is off.

import { Logger } from '../../../services/logger';

const log = Logger.create('PhoneBoot');

export const PHONE_BOOT_PHASES = [
  'boot-start',
  'repository-open',
  'stores-hydrated',
  'timeline-visible',
  'first-preview-frame',
  'gpu-ready',
  'gpu-failed',
] as const;

export type PhoneBootPhase = (typeof PHONE_BOOT_PHASES)[number];

/** A phase later than this (ms since navigation start) counts as a slow boot. */
export const SLOW_BOOT_MS = 8_000;

export interface PhoneBootMark {
  phase: PhoneBootPhase;
  /** ms since navigation start (performance.now()). */
  at: number;
  detail?: string;
}

interface PhoneBootRecord {
  marks: PhoneBootMark[];
  slowReported: boolean;
}

type BootWindow = typeof globalThis & { __MS_PHONE_BOOT__?: PhoneBootRecord };

function record(): PhoneBootRecord {
  const holder = globalThis as BootWindow;
  holder.__MS_PHONE_BOOT__ ??= { marks: [], slowReported: false };
  return holder.__MS_PHONE_BOOT__;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** One line per mark: 'boot-start 120 ms · repository-open 340 ms (+220)'. */
export function formatPhoneBootTimeline(marks: readonly PhoneBootMark[]): string {
  return marks
    .map((mark, index) => {
      const delta = index > 0 ? ` (+${Math.round(mark.at - marks[index - 1].at)})` : '';
      return `${mark.phase} ${Math.round(mark.at)} ms${delta}${mark.detail ? ` [${mark.detail}]` : ''}`;
    })
    .join(' · ');
}

/** Records `phase` once; later calls for the same phase are ignored. Returns whether it was new. */
export function markPhoneBootPhase(phase: PhoneBootPhase, detail?: string, at: number = now()): boolean {
  const state = record();
  if (state.marks.some((mark) => mark.phase === phase)) return false;
  const mark: PhoneBootMark = detail ? { phase, at, detail } : { phase, at };
  state.marks.push(mark);
  log.info(`Boot phase ${phase} at ${Math.round(at)} ms`, detail ? { detail } : undefined);
  if (!state.slowReported && isPhoneBootSettled(state.marks)) {
    const latest = state.marks.reduce((max, entry) => Math.max(max, entry.at), 0);
    const gpuFailed = state.marks.some((entry) => entry.phase === 'gpu-failed');
    if (latest > SLOW_BOOT_MS || gpuFailed) {
      state.slowReported = true;
      log.warn(gpuFailed ? 'Phone boot finished without a GPU' : `Slow phone boot: settled after ${Math.round(latest)} ms`, {
        timeline: formatPhoneBootTimeline(state.marks),
      });
    }
  }
  return true;
}

/** The boot is settled once the timeline shows and the GPU has either drawn a frame or failed. */
export function isPhoneBootSettled(marks: readonly PhoneBootMark[]): boolean {
  const has = (phase: PhoneBootPhase) => marks.some((mark) => mark.phase === phase);
  return has('timeline-visible') && (has('gpu-failed') || (has('gpu-ready') && has('first-preview-frame')));
}

/** Copy of the marks recorded so far, in recording order. */
export function readPhoneBootTimeline(): PhoneBootMark[] {
  return [...record().marks];
}

export function resetPhoneBootTimelineForTests(): void {
  (globalThis as BootWindow).__MS_PHONE_BOOT__ = undefined;
}
