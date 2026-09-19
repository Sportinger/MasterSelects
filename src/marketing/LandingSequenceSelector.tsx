import { IconCheck, IconTimeline } from '@tabler/icons-react';

import type { LandingSequenceSummary } from './LandingPageProps';

interface LandingSequenceSelectorProps {
  disabled: boolean;
  onSelect?: (sequenceId: string) => Promise<void> | void;
  selectedSequenceId?: string | null;
  sequences: LandingSequenceSummary[];
}

function formatSequenceDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

export function LandingSequenceSelector({
  disabled,
  onSelect,
  selectedSequenceId,
  sequences,
}: LandingSequenceSelectorProps) {
  if (sequences.length === 0) return null;

  return (
    <section className="landing-sequence-selector" aria-label="Available sequences">
      <span className="landing-sequence-selector-label">Sequences</span>
      <div className="landing-sequence-list">
        {sequences.map((sequence) => {
          const selected = sequence.id === selectedSequenceId;
          return (
            <button
              aria-label={`Load sequence ${sequence.name}`}
              aria-pressed={selected}
              className={selected ? 'is-selected' : ''}
              disabled={disabled}
              key={sequence.id}
              type="button"
              onClick={() => void Promise.resolve(onSelect?.(sequence.id)).catch(() => undefined)}
            >
              <span className="landing-sequence-icon" aria-hidden="true">
                {selected ? <IconCheck /> : <IconTimeline />}
              </span>
              <span className="landing-sequence-copy">
                <strong>{sequence.name}</strong>
                <small>
                  {formatSequenceDuration(sequence.duration)} · {sequence.clipCount}{' '}
                  {sequence.clipCount === 1 ? 'clip' : 'clips'}
                  {sequence.hasTranscript ? ' · Transcript' : ''}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
