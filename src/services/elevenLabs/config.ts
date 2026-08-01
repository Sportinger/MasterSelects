export const ELEVENLABS_MP3_OUTPUT_FORMATS = [
  'mp3_44100_128',
  'mp3_44100_192',
  'mp3_22050_32',
] as const;

export type ElevenLabsMp3OutputFormat = typeof ELEVENLABS_MP3_OUTPUT_FORMATS[number];

export const DEFAULT_ELEVENLABS_SPEECH_OUTPUT_FORMAT: ElevenLabsMp3OutputFormat = 'mp3_44100_128';
export const ELEVENLABS_MP3_MIME_TYPE = 'audio/mpeg';
export const ELEVENLABS_MP3_EXTENSION = 'mp3';
export const ELEVENLABS_PROVIDER_USD_PER_CREDIT = 0.0001;
export const MASTERSELECTS_HOSTED_USD_PER_CREDIT = 0.001;

export function isElevenLabsMp3OutputFormat(value: string): value is ElevenLabsMp3OutputFormat {
  return ELEVENLABS_MP3_OUTPUT_FORMATS.includes(value as ElevenLabsMp3OutputFormat);
}
