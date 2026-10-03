import {
  resolveClipSourceTime, type ClipRetimeTiming, type SpeedSource,
} from './clipRetime';

/** Derived runtime status only; never persist a preview limitation on the clip. */
export function resolveAudioPreviewRetime(clip: ClipRetimeTiming, local: number, source?: SpeedSource) {
  const sample = resolveClipSourceTime(clip, local, source);
  const mutedReason = clip.timeRemap?.kind === 'freeze'
    ? 'Audio is silent while the clip is frozen.'
    : clip.timeRemap?.kind === 'warp'
    ? 'Warp audio requires a processed preview buffer; source playback is muted while preparing.'
    : clip.timeRemap?.kind === 'loop'
    ? 'Loop audio requires a processed preview buffer; source playback is muted while preparing.'
    : sample.isHold
    ? 'Audio is silent while source time is held.'
    : sample.sourceRate < 0
      ? 'Backward audio requires a processed preview buffer; source playback is muted while preparing.'
      : sample.sourceRate < 0.25 || sample.sourceRate > 4
        ? 'Audio rate is outside the live 0.25x–4x range; audio is rendered for export.'
        : undefined;
  return { ...sample, mutedReason };
}

/** Exposes the per-clip reason on runtime media, without changing project data. */
export function flagAudioPreviewRetime(element: HTMLMediaElement, reason: string | undefined): void {
  if (!element.dataset) return;
  if (reason) element.dataset.audioPreviewMutedReason = reason;
  else delete element.dataset.audioPreviewMutedReason;
}
