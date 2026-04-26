// Transcript Tab - View and interact with clip transcription
import { useState, useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TranscriptWord } from '../../../types';

const LANGUAGES = [
  { code: 'auto', name: 'Auto-Detect' },
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

function formatTimeShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface TranscriptTabProps {
  clipId: string;
  transcript: TranscriptWord[];
  transcriptStatus: 'none' | 'transcribing' | 'ready' | 'error';
  transcriptProgress: number;
  clipStartTime: number;
  inPoint: number;
  outPoint: number;
}

export function TranscriptTab({ clipId, transcript, transcriptStatus, transcriptProgress, clipStartTime, inPoint, outPoint }: TranscriptTabProps) {
  // Reactive data - subscribe to specific value only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  // Actions from getState() - stable, no subscription needed
  const { setPlayheadPosition } = useTimelineStore.getState();
  const [language, setLanguage] = useState(() => localStorage.getItem('transcriptLanguage') || 'auto');
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate clip-local time for word matching
  const clipLocalTime = playheadPosition - clipStartTime + inPoint;

  // Find current word based on playhead position
  const currentWordId = useMemo(() => {
    if (clipLocalTime < 0 || transcript.length === 0) return null;
    for (const word of transcript) {
      if (clipLocalTime >= word.start && clipLocalTime <= word.end) {
        return word.id;
      }
    }
    return null;
  }, [transcript, clipLocalTime]);

  // Filter words by search query
  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return transcript;
    const query = searchQuery.toLowerCase();
    return transcript.filter(w => w.text.toLowerCase().includes(query));
  }, [transcript, searchQuery]);

  const handleWordClick = useCallback((sourceTime: number) => {
    const timelinePosition = clipStartTime + (sourceTime - inPoint);
    setPlayheadPosition(Math.max(0, timelinePosition));
  }, [clipStartTime, inPoint, setPlayheadPosition]);

  // Get transcribedRanges from MediaFile for accurate coverage
  const clipCoverage = useMemo(() => {
    if (!transcript.length) return 0;
    const clipDuration = outPoint - inPoint;
    if (clipDuration <= 0) return 0;
    // Look up MediaFile's transcribedRanges
    const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
    const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
    const mediaFile = mediaFileId ? useMediaStore.getState().files.find(f => f.id === mediaFileId) : null;
    const ranges = mediaFile?.transcribedRanges ?? [];
    if (ranges.length > 0) {
      let covered = 0;
      for (const [rs, re] of ranges) {
        const s = Math.max(rs, inPoint);
        const e = Math.min(re, outPoint);
        if (s < e) covered += e - s;
      }
      return Math.min(1, covered / clipDuration);
    }
    // Fallback: word envelope for old data
    const wordsInRange = transcript.filter(w => w.end > inPoint && w.start < outPoint);
    if (wordsInRange.length === 0) return 0;
    const minStart = Math.max(inPoint, Math.min(...wordsInRange.map(w => w.start)));
    const maxEnd = Math.min(outPoint, Math.max(...wordsInRange.map(w => w.end)));
    return Math.min(1, (maxEnd - minStart) / clipDuration);
  }, [transcript, inPoint, outPoint, clipId]);

  const isPartial = transcriptStatus === 'ready' && clipCoverage > 0 && clipCoverage < 0.98;

  const handleTranscribe = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language);
  }, [clipId, language]);

  const handleContinue = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language, { continueMode: true });
  }, [clipId, language]);

  const handleCancel = useCallback(async () => {
    const { cancelTranscription } = await import('../../../services/clipTranscriber');
    cancelTranscription();
  }, []);

  const handleDelete = useCallback(async () => {
    const { clearClipTranscript } = await import('../../../services/clipTranscriber');
    clearClipTranscript(clipId);
  }, [clipId]);

  const handleLanguageChange = useCallback((newLanguage: string) => {
    setLanguage(newLanguage);
    localStorage.setItem('transcriptLanguage', newLanguage);
  }, []);

  return (
    <div className="properties-tab-content transcript-tab">
      {/* Language and actions */}
      <div className="properties-section">
        <div className="control-row">
          <label>Language</label>
          <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={transcriptStatus === 'transcribing'}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div className="transcript-tab-actions">
          {transcriptStatus !== 'ready' && transcriptStatus !== 'transcribing' && (
            <button className="btn btn-sm" onClick={handleTranscribe}>Transcribe</button>
          )}
          {transcriptStatus === 'transcribing' && (
            <button className="btn btn-sm btn-danger" onClick={handleCancel}>Cancel</button>
          )}
          {transcriptStatus === 'ready' && (
            <>
              {isPartial && (
                <button className="btn btn-sm btn-accent" onClick={handleContinue}>Continue ({Math.round(clipCoverage * 100)}%)</button>
              )}
              <button className="btn btn-sm" onClick={handleTranscribe}>Re-transcribe</button>
              <button className="btn btn-sm btn-danger" onClick={handleDelete}>Delete</button>
            </>
          )}
        </div>
        {/* Coverage bar */}
        {transcriptStatus === 'ready' && clipCoverage > 0 && (
          <div className="coverage-bar" style={{ marginTop: '4px' }}>
            <div className="coverage-bar-bg">
              <div className="coverage-bar-fill transcript-fill" style={{ width: `${Math.round(clipCoverage * 100)}%` }} />
            </div>
            <span className="coverage-bar-text">{Math.round(clipCoverage * 100)}% transcribed</span>
          </div>
        )}
      </div>

      {/* Progress */}
      {transcriptStatus === 'transcribing' && (
        <div className="properties-section">
          <div className="transcript-progress-bar">
            <div className="transcript-progress-fill" style={{ width: `${transcriptProgress}%` }} />
          </div>
          <span className="transcript-progress-text">{transcriptProgress}%</span>
        </div>
      )}

      {/* Search */}
      {transcript.length > 0 && (
        <div className="properties-section">
          <input type="text" placeholder="Search transcript..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} className="transcript-search-input" />
        </div>
      )}

      {/* Transcript content */}
      <div className="transcript-content-embedded" ref={containerRef}>
        {transcript.length === 0 ? (
          <div className="transcript-empty-state">
            {transcriptStatus === 'transcribing' ? 'Transcribing...' : 'No transcript. Click "Transcribe" to generate.'}
          </div>
        ) : (
          <div className="transcript-words-flow">
            {filteredWords.map(word => (
              <span
                key={word.id}
                className={`transcript-word-inline ${word.id === currentWordId ? 'active' : ''} ${searchQuery && word.text.toLowerCase().includes(searchQuery.toLowerCase()) ? 'highlighted' : ''}`}
                onClick={() => handleWordClick(word.start)}
                title={formatTimeShort(word.start)}
              >
                {word.text}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {transcriptStatus === 'ready' && (
        <div className="transcript-status-bar">
          {transcript.length} words
        </div>
      )}
    </div>
  );
}
