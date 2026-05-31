// Shared audio-waveform rendering used by the Source Monitor and the media
// panel slot/board waveform previews (#202) so they look identical.

import type { MediaFile } from '../../stores/mediaStore';

export type AudioWaveformStatus = NonNullable<MediaFile['waveformStatus']>;

export const SOURCE_WAVEFORM_FILL = '#020403';

export function getAudioWaveformStatus(file: MediaFile, isAudio: boolean): AudioWaveformStatus {
  if (!isAudio) return 'idle';
  if ((file.waveform?.length ?? 0) > 0) {
    return file.waveformStatus ?? 'ready';
  }
  return file.waveformStatus ?? 'idle';
}

export function getSourceWaveformChannels(file: MediaFile): readonly (readonly number[])[] {
  const channels = file.waveformChannels?.filter((channel) => channel.length > 0) ?? [];
  if (channels.length > 0) return channels;
  if (file.waveform?.length) return [file.waveform, file.waveform];
  return [];
}

/**
 * Draw the already-generated waveform peaks (two stereo lanes) into a canvas,
 * sized to the canvas's parent. `fillColor` lets callers on dark backgrounds
 * (the media board thumbnails) override the default near-black fill.
 */
export function drawSourceAudioWaveformCanvas(
  canvas: HTMLCanvasElement,
  channels: readonly (readonly number[])[],
  status: AudioWaveformStatus,
  fillColor: string = SOURCE_WAVEFORM_FILL,
): void {
  const container = canvas.parentElement;
  const rect = container?.getBoundingClientRect();
  const cssWidth = Math.round(rect?.width || container?.clientWidth || canvas.clientWidth || 0);
  const cssHeight = Math.round(rect?.height || container?.clientHeight || canvas.clientHeight || 0);
  if (cssWidth <= 1 || cssHeight <= 1) return;

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const context = canvas.getContext('2d');
  if (!context) return;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const renderChannels = channels.length > 0 ? channels.slice(0, 2) : [];
  if (renderChannels.length === 0) {
    if (status === 'generating') {
      context.fillStyle = 'rgba(2, 4, 3, 0.22)';
      for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
        const laneTop = (cssHeight / 2) * channelIndex;
        const laneHeight = cssHeight / 2;
        const centerY = laneTop + laneHeight / 2;
        for (let x = 0; x < cssWidth; x += 4) {
          const amplitude = 0.08 + ((x / 4) % 7) * 0.015;
          const halfHeight = Math.max(1, laneHeight * amplitude);
          context.fillRect(x, centerY - halfHeight, 2, halfHeight * 2);
        }
      }
    }
    return;
  }

  context.fillStyle = fillColor;
  context.globalAlpha = status === 'skipped' || status === 'error'
    ? 0.32
    : status === 'generating'
      ? 0.74
      : 0.98;

  for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
    const channel = renderChannels[channelIndex] ?? renderChannels[0];
    if (!channel || channel.length === 0) continue;

    const laneTop = (cssHeight / 2) * channelIndex;
    const laneHeight = cssHeight / 2;
    const centerY = laneTop + laneHeight / 2;
    const maxHalfHeight = Math.max(1, laneHeight * 0.46);

    for (let x = 0; x < cssWidth; x += 1) {
      const start = Math.floor((x / cssWidth) * channel.length);
      const end = Math.max(start + 1, Math.ceil(((x + 1) / cssWidth) * channel.length));
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end && sampleIndex < channel.length; sampleIndex += 1) {
        peak = Math.max(peak, Math.abs(channel[sampleIndex] ?? 0));
      }

      const halfHeight = Math.max(0.6, Math.min(1, peak) * maxHalfHeight);
      context.fillRect(x, centerY - halfHeight, 1, halfHeight * 2);
    }
  }

  context.globalAlpha = 1;
}
