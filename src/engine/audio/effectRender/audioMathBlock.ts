import { processAudioMathChannels, type AudioMathProgram } from '../../../services/operators/audioOperatorGraph';

/** The output buffer belongs to the audio host; the graph never retains buffers. */
export function processAudioMathBlock(program: AudioMathProgram, input: AudioBuffer, output: AudioBuffer): void {
  processAudioMathChannels(program,
    Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel)),
    Array.from({ length: output.numberOfChannels }, (_, channel) => output.getChannelData(channel)));
}
