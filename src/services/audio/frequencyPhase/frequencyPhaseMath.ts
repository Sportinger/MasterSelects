const SILENCE_FLOOR_DB = -120;
export const EPSILON = 1e-20;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function safeSample(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function powerToDb(power: number): number {
  if (!Number.isFinite(power) || power <= EPSILON) {
    return SILENCE_FLOOR_DB;
  }
  return Math.max(SILENCE_FLOOR_DB, 10 * Math.log10(power));
}

export function ratioToDb(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || numerator <= EPSILON) {
    return -120;
  }
  return clamp(10 * Math.log10(numerator / Math.max(denominator, EPSILON)), -120, 120);
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window[0] = 1;
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
  }

  return window;
}

export function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const size = real.length;
  let reversed = 0;

  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;

    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImag = imag[index];
      imag[index] = imag[reversed];
      imag[reversed] = tmpImag;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let pair = 0; pair < length / 2; pair += 1) {
        const evenIndex = offset + pair;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] * twiddleReal - imag[oddIndex] * twiddleImag;
        const oddImag = real[oddIndex] * twiddleImag + imag[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextTwiddleReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

export function createMonoMix(buffer: AudioBuffer): Float32Array {
  const mix = new Float32Array(buffer.length);
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const data = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      mix[sampleIndex] += safeSample(data[sampleIndex] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mix;
}
