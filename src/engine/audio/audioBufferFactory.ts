function normalizeBufferLength(length: number): number {
  return Math.max(1, Math.floor(length));
}

function createFallbackAudioBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const safeLength = normalizeBufferLength(length);
  const channelData = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(safeLength),
  );

  return {
    numberOfChannels,
    length: safeLength,
    sampleRate,
    duration: safeLength / sampleRate,
    getChannelData(channelIndex: number) {
      const channel = channelData[channelIndex];
      if (!channel) {
        throw new Error(`AudioBuffer channel ${channelIndex} is out of range.`);
      }
      return channel;
    },
    copyFromChannel(destination: Float32Array, channelNumber: number, bufferOffset = 0) {
      const source = this.getChannelData(channelNumber);
      destination.set(source.subarray(bufferOffset, bufferOffset + destination.length));
    },
    copyToChannel(source: Float32Array, channelNumber: number, bufferOffset = 0) {
      this.getChannelData(channelNumber).set(source, bufferOffset);
    },
  } as AudioBuffer;
}

export function createBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const safeLength = normalizeBufferLength(length);
  const AudioBufferCtor = globalThis.AudioBuffer;

  if (typeof AudioBufferCtor === 'function') {
    return new AudioBufferCtor({
      numberOfChannels,
      length: safeLength,
      sampleRate,
    });
  }

  return createFallbackAudioBuffer(numberOfChannels, safeLength, sampleRate);
}

export function createBufferLike(buffer: AudioBuffer): AudioBuffer {
  return createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
}
