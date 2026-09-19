export interface CutBoundaryWord { start: number; end: number }
export interface TranscriptCutBoundary {
  cutStart: number;
  cutEnd: number;
  cutBoundarySource: 'waveform' | 'padding';
}
type Samples = Pick<AudioBuffer, 'sampleRate' | 'length' | 'numberOfChannels' | 'getChannelData'>;

/** Cut handles are separate from subtitle/alignment times. Never move into a word. */
export function findTranscriptCutBoundaries(
  words: readonly CutBoundaryWord[],
  duration: number,
  buffer?: Samples | null,
): TranscriptCutBoundary[] {
  const channels = buffer
    ? Array.from({ length: buffer.numberOfChannels }, (_,index) => buffer.getChannelData(index))
    : [];
  function quietBoundary(low: number, high: number, preferred: number): number {
    if (!buffer || channels.length === 0 || high <= low) return preferred;
    const radius = Math.max(1, Math.round(buffer.sampleRate * 0.003));
    let best = preferred;
    let bestScore = Infinity;
    for (let time = low; time <= high + 1e-8; time += 0.002) {
      const center = Math.round(time * buffer.sampleRate);
      const start = Math.max(0, center - radius);
      const end = Math.min(buffer.length, center + radius);
      if (end <= start) continue;
      // The loudest channel protects speech present on only one stereo side.
      let energy = 0;
      for (const channel of channels) {
        let sum = 0;
        for (let sample = start; sample < end; sample += 1) sum += channel[sample] ** 2;
        energy = Math.max(energy, sum / (end - start));
      }
      // Only snap into genuinely quiet audio. Never chase a zero crossing in speech.
      if (energy > 0.0001) continue;
      const score = energy + Math.abs(time - preferred) * 0.0001;
      if (score < bestScore) { bestScore = score; best = time; }
    }
    return best;
  }
  return words.map((word, index) => {
    const previous = words[index - 1];
    const next = words[index + 1];
    const start = Math.max(0, Math.min(duration, word.start));
    const end = Math.max(start, Math.min(duration, word.end));
    // Share gaps at their midpoint so two independently selected neighbors never overlap.
    const lower = Math.max(0, start - 0.08,
      previous ? Math.min(start, (previous.end + start) / 2) : 0);
    const upper = Math.min(duration, end + 0.12,
      next ? Math.max(end, (end + next.start) / 2) : duration);
    const preferredStart = Math.max(lower, start - 0.03);
    const preferredEnd = Math.min(upper, end + 0.05);
    return {
      cutStart: Math.min(start, Number(quietBoundary(lower, preferredStart, preferredStart).toFixed(6))),
      cutEnd: Math.max(end, Number(quietBoundary(preferredEnd, upper, preferredEnd).toFixed(6))),
      cutBoundarySource: buffer ? 'waveform' : 'padding',
    };
  });
}
