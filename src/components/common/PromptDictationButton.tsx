import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startPromptDictation,
  type PromptDictationSession,
} from '../../services/transcription/promptDictation';

type DictationPhase = 'error' | 'finishing' | 'idle' | 'listening' | 'requesting';

interface DictationStatus {
  detail?: string;
  phase: DictationPhase;
}

interface PromptDictationButtonProps {
  className?: string;
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

function statusTitle(status: DictationStatus): string {
  if (status.phase === 'requesting') return 'Requesting microphone access…';
  if (status.phase === 'listening') {
    return status.detail
      ? `Listening with local Whisper — ${status.detail}. Click to stop.`
      : 'Listening with local Whisper — click to stop.';
  }
  if (status.phase === 'finishing') return 'Finishing local Whisper transcription…';
  if (status.phase === 'error') return `Dictation failed: ${status.detail ?? 'Unknown error'}. Click to retry.`;
  return 'Dictate prompt with local Whisper';
}

export function appendPromptDictationText(current: string, transcript: string): string {
  const next = transcript.trim();
  if (!next) return current;
  if (!current) return next;
  return /\s$/.test(current) ? `${current}${next}` : `${current} ${next}`;
}

export function PromptDictationButton({
  className = '',
  disabled = false,
  onTranscript,
}: PromptDictationButtonProps) {
  const [status, setStatus] = useState<DictationStatus>({ phase: 'idle' });
  const sessionRef = useRef<PromptDictationSession | null>(null);
  const operationRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const operation = ++operationRef.current;
    setStatus({ phase: 'finishing' });
    try {
      await session.stop();
      if (operationRef.current === operation) setStatus({ phase: 'idle' });
    } catch (error) {
      if (operationRef.current !== operation) return;
      setStatus({
        phase: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const start = useCallback(async () => {
    const operation = ++operationRef.current;
    setStatus({ phase: 'requesting' });
    try {
      const session = await startPromptDictation({
        onError: (error) => {
          if (operationRef.current !== operation) return;
          sessionRef.current = null;
          setStatus({ phase: 'error', detail: error.message });
        },
        onProgress: ({ message }) => {
          if (operationRef.current !== operation) return;
          setStatus(current => ({ ...current, detail: message }));
        },
        onTranscript: (text) => {
          if (operationRef.current === operation) onTranscriptRef.current(text);
        },
      });
      if (operationRef.current !== operation) {
        await session.cancel();
        return;
      }
      sessionRef.current = session;
      setStatus(current => ({ ...current, phase: 'listening' }));
    } catch (error) {
      if (operationRef.current !== operation) return;
      setStatus({
        phase: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => () => {
    operationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.cancel();
  }, []);

  const isListening = status.phase === 'listening';
  const isBusy = status.phase === 'requesting' || status.phase === 'finishing';

  return (
    <button
      aria-label={isListening ? 'Stop prompt dictation' : 'Start prompt dictation'}
      aria-pressed={isListening}
      className={`prompt-dictation-button ${className} is-${status.phase}`.trim()}
      disabled={isBusy || (disabled && !isListening)}
      onClick={() => {
        if (isListening) void stop();
        else void start();
      }}
      title={statusTitle(status)}
      type="button"
    >
      <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.45" viewBox="0 0 16 16" width="16">
        <rect height="8" rx="2.5" width="5" x="5.5" y="1.5" />
        <path d="M3.5 7.2v.8a4.5 4.5 0 0 0 9 0v-.8M8 12.5v2M5.8 14.5h4.4" />
      </svg>
      <span className="prompt-dictation-pulse" aria-hidden="true" />
    </button>
  );
}
