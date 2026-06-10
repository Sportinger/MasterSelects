export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function estimateExportSize(bitrate: number, startTime: number, endTime: number) {
  const durationSec = endTime - startTime;
  const bytes = (bitrate / 8) * durationSec;
  if (bytes > 1024 * 1024 * 1024) {
    return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `~${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

interface ExportDialogSummaryArgs {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  startTime: number;
  endTime: number;
  stackedAlpha: boolean;
}

export function getExportDialogSummary({
  width,
  height,
  fps,
  bitrate,
  startTime,
  endTime,
  stackedAlpha,
}: ExportDialogSummaryArgs) {
  const outputHeight = stackedAlpha ? height * 2 : height;
  const stackedAlphaLabel = stackedAlpha ? '(stacked alpha)' : '';

  return {
    output: `${width}x${outputHeight}`,
    stackedAlphaLabel,
    duration: formatTime(endTime - startTime),
    totalFrames: Math.ceil((endTime - startTime) * fps),
    estimatedSize: estimateExportSize(bitrate, startTime, endTime),
  };
}
