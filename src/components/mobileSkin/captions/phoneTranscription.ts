// Starting speech transcription from the phone with the editor's transcriber (transcribeClip), and
// the state that decides whether it can run: the account session (hosted providers need sign-in
// and credits) and the provider chosen in the editor settings. The editor's transcriber returns
// without a word in a few cases (no file, no sound, another run active); the phone checks those
// first and says so instead of failing silently.

import { hasActiveTranscriptionRun } from '../../../services/transcription/transcriptionRunController';
import { isAudioBearingFile } from '../../../services/transcription/audioPrep';
import { Logger } from '../../../services/logger';
import type { TranscriptionProvider } from '../../../stores/settingsStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { hasHostedAiSession, useAccountStore } from '../../../stores/accountStore';
import { useTimelineStore } from '../../../stores/timeline';

const log = Logger.create('PhoneTranscription');

export const PHONE_TRANSCRIPTION_PROVIDERS: readonly { id: TranscriptionProvider; label: string; hosted: boolean; note: string }[] = [
  { id: 'local', label: 'On this phone', hosted: false, note: 'Local Whisper runs on this device: private, free, slower. The first run downloads the model.' },
  { id: 'hybrid', label: 'Best quality', hosted: true, note: 'Deepgram text and timing plus OpenAI speakers, with your MasterSelects credits.' },
  { id: 'deepgram', label: 'Deepgram', hosted: true, note: 'Hosted Deepgram Nova-3, with your MasterSelects credits.' },
  { id: 'openai', label: 'OpenAI Whisper', hosted: true, note: 'Hosted OpenAI Whisper, with your MasterSelects credits.' },
];

export type PhoneTranscriptionReadiness =
  | { kind: 'ready'; provider: TranscriptionProvider }
  | { kind: 'needs-account'; provider: TranscriptionProvider; reason: string };

export function phoneTranscriptionReadiness(provider: TranscriptionProvider, signedIn: boolean): PhoneTranscriptionReadiness {
  if (provider === 'local' || signedIn) return { kind: 'ready', provider };
  return {
    kind: 'needs-account',
    provider,
    reason: 'Hosted transcription needs a signed-in account with credits. Sign in (Settings, Account), or switch to "On this phone" to transcribe here for free.',
  };
}

export function usePhoneTranscriptionReadiness(): PhoneTranscriptionReadiness {
  const provider = useSettingsStore((state) => state.transcriptionProvider);
  const signedIn = useAccountStore((state) => hasHostedAiSession(state.session));
  return phoneTranscriptionReadiness(provider, signedIn);
}

/** Why the editor would not transcribe this clip, or null when it can. */
export function phoneTranscribeBlocker(clipId: string): string | null {
  if (hasActiveTranscriptionRun()) return 'Another transcription is running. Wait for it or cancel it first.';
  const state = useTimelineStore.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return 'The clip is no longer on the timeline.';
  if (!clip.file || clip.file.size === 0) return `${clip.name} has no media file loaded on this device yet (relink or wait for it to load).`;
  if (!isAudioBearingFile(clip.file)) return `${clip.name} has no sound to transcribe.`;
  const readiness = phoneTranscriptionReadiness(useSettingsStore.getState().transcriptionProvider, hasHostedAiSession(useAccountStore.getState().session));
  return readiness.kind === 'needs-account' ? readiness.reason : null;
}

/** Starts the editor's transcription of one clip; resolves when the run ends (status lands on the clip). */
export async function startPhoneTranscription(clipId: string): Promise<string | null> {
  const blocker = phoneTranscribeBlocker(clipId);
  if (blocker) return blocker;
  try {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, 'auto', { provider: useSettingsStore.getState().transcriptionProvider });
    const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
    return clip?.transcriptStatus === 'error' ? clip.transcriptMessage ?? 'Transcription failed.' : null;
  } catch (error) {
    log.warn('Transcription failed', error);
    return `Transcription failed: ${error instanceof Error ? error.message : String(error)}.`;
  }
}

export async function cancelPhoneTranscription(): Promise<void> {
  const { cancelTranscription } = await import('../../../services/clipTranscriber');
  cancelTranscription();
}
