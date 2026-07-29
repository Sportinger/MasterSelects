export function hasUsableAudioProxy(
  mediaFile: { hasProxyAudio?: boolean; audioProxyStatus?: string } | undefined,
): boolean {
  return mediaFile?.hasProxyAudio === true || mediaFile?.audioProxyStatus === 'ready';
}

export function dbToLinearGain(db: number | undefined): number {
  return Number.isFinite(db) ? 10 ** ((db ?? 0) / 20) : 1;
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frameCount = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const output = new ArrayBuffer(44 + dataSize);
  const view = new DataView(output);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = Array.from({ length: channelCount }, (_, channelIndex) =>
    buffer.getChannelData(channelIndex)
  );
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channelIndex]?.[frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: 'audio/wav' });
}

export function createAudioElementFromBuffer(buffer: AudioBuffer): { element: HTMLAudioElement; url: string } {
  const url = URL.createObjectURL(audioBufferToWavBlob(buffer));
  const element = document.createElement('audio');
  element.src = url;
  element.preload = 'auto';
  return { element, url };
}

export function createAudioElementFromUrl(url: string): HTMLAudioElement {
  const element = document.createElement('audio');
  element.src = url;
  element.preload = 'auto';
  return element;
}

export function createAudioProxyInstance(base: HTMLAudioElement): HTMLAudioElement | null {
  const src = base.currentSrc || base.src;
  if (!src) return null;

  const element = document.createElement('audio');
  element.src = src;
  element.preload = 'auto';
  element.crossOrigin = base.crossOrigin;
  return element;
}

export function getAudioElementSrcKind(src: string | undefined): 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('file:')) return 'file-path';
  if (/^https?:\/\//i.test(src)) return 'remote-url';
  if (src.startsWith('mediastream:')) return 'media-source';
  return 'project-path';
}

export function pauseAudioElement(element: HTMLAudioElement | HTMLVideoElement | null | undefined): void {
  if (!element || element.paused) return;
  element.pause();
}

export function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}
