import { useEffect, useRef } from 'react';
import {
  buildAnalysisSceneTranscriptTurns,
  findActiveAnalysisSceneWord,
  formatAnalysisSceneTime,
  type AnalysisSceneRange,
  type AnalysisSceneSpeakerTurn,
  type AnalysisSceneTranscriptWord,
} from './analysisSceneViewModel';

export interface AnalysisSceneTranscriptProps {
  sceneRange: AnalysisSceneRange;
  words: readonly AnalysisSceneTranscriptWord[];
  speakerTurns: readonly AnalysisSceneSpeakerTurn[];
  playheadTime?: number;
  /** Caps rendering for a virtualised card; remaining transcript stays queryable. */
  maxTurns?: number;
  maxWordsPerTurn?: number;
  showSpeakerLabels?: boolean;
  /** Keeps the current word in view only while playback follow is active. */
  followPlayback?: boolean;
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void;
}

export function AnalysisSceneTranscript({
  sceneRange,
  words,
  speakerTurns,
  playheadTime,
  maxTurns = 12,
  maxWordsPerTurn = 80,
  showSpeakerLabels = true,
  followPlayback = false,
  onWordClick,
}: AnalysisSceneTranscriptProps) {
  const allTurns = buildAnalysisSceneTranscriptTurns(sceneRange, words, speakerTurns);
  const turns = allTurns.slice(0, Math.max(0, maxTurns));
  const activeWord = findActiveAnalysisSceneWord(words, playheadTime ?? Number.NaN);
  const activeWordRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!followPlayback || !activeWordRef.current) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    activeWordRef.current.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }, [activeWord?.id, activeWord?.start, followPlayback]);
  if (turns.length === 0) {
    return <p className="AnalysisSceneTranscript__empty">No transcript coverage for this scene.</p>;
  }

  return (
    <section aria-label="Scene transcript" className="AnalysisSceneTranscript">
      {turns.map(turn => {
        const visibleWords = turn.words.slice(0, Math.max(0, maxWordsPerTurn));
        const personText = turn.state === 'offscreen' ? 'Off-screen' : turn.state === 'unknown' ? 'Speaker mapping unknown' : 'Active speaker';
        return (
          <article className="AnalysisSceneTranscript__turn" key={turn.id}>
            <header className="AnalysisSceneTranscript__header">
              {showSpeakerLabels && (
                <>
                  <span className="AnalysisSceneTranscript__speaker">{turn.speakerLabel}</span>
                  <span className={`AnalysisSceneTranscript__state AnalysisSceneTranscript__state--${turn.state}`}>{personText}</span>
                </>
              )}
              <button aria-label={`Seek to ${turn.speakerLabel} at ${formatAnalysisSceneTime(turn.start)}`} className="AnalysisSceneTranscript__time" onClick={() => onWordClick?.(turn.words[0])} type="button">
                {formatAnalysisSceneTime(turn.start)}–{formatAnalysisSceneTime(turn.end)}
              </button>
            </header>
            <div className="AnalysisSceneTranscript__words">
              {visibleWords.map(word => {
                const active = activeWord?.id === word.id && activeWord.start === word.start;
                return (
                  <button
                    aria-current={active ? 'true' : undefined}
                    className={[
                      'AnalysisSceneTranscript__word',
                      active ? 'AnalysisSceneTranscript__word--active' : '',
                      word.needsReview ? 'AnalysisSceneTranscript__word--review' : '',
                    ].filter(Boolean).join(' ')}
                    key={`${word.id}:${word.start}:${word.end}`}
                    onClick={() => onWordClick?.(word)}
                    ref={active ? activeWordRef : undefined}
                    title={`${formatAnalysisSceneTime(word.start)}–${formatAnalysisSceneTime(word.end)}${word.confidence === undefined ? '' : `, ${Math.round(word.confidence * 100)}% confidence`}`}
                    type="button"
                  >
                    {word.text}
                  </button>
                );
              })}
              {turn.words.length > visibleWords.length && <span className="AnalysisSceneTranscript__more">+{turn.words.length - visibleWords.length} more words</span>}
            </div>
          </article>
        );
      })}
      {allTurns.length > turns.length && <p className="AnalysisSceneTranscript__more">More speaker turns are available in the transcript search.</p>}
    </section>
  );
}
