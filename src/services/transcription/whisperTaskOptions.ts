export interface WhisperTaskOptions {
  language?: string;
  task: 'transcribe';
}

export function buildWhisperTaskOptions(language: string): WhisperTaskOptions {
  return language === 'auto' || language === 'en'
    ? { task: 'transcribe' }
    : { language, task: 'transcribe' };
}
