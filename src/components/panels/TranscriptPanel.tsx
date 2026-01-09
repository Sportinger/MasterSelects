// Transcript Panel - Premiere Pro-style speech-to-text transcript viewer

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import type { TranscriptWord } from '../../types';
import './TranscriptPanel.css';

// =============================================================================
// Sub-components
// =============================================================================

interface TranscriptEntryProps {
  words: TranscriptWord[];
  speaker: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  onClick: (time: number) => void;
}

function TranscriptEntry({
  words,
  speaker,
  startTime,
  endTime,
  isActive,
  onClick,
}: TranscriptEntryProps) {
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const frames = Math.floor((seconds % 1) * 30); // Assuming 30fps

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const text = words.map(w => w.text).join(' ');

  return (
    <div
      className={`transcript-entry ${isActive ? 'active' : ''}`}
      onClick={() => onClick(startTime)}
    >
      <div className="transcript-entry-header">
        <span className="transcript-speaker">{speaker}</span>
        <span className="transcript-time">
          {formatTime(startTime)} - {formatTime(endTime)}
        </span>
      </div>
      <div className="transcript-text">{text}</div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function TranscriptPanel() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showMarkersGlobal, setShowMarkersGlobal] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timeline store
  const {
    clips,
    selectedClipId,
    playheadPosition,
    setPlayheadPosition,
  } = useTimelineStore();

  // Get selected clip or first clip with transcript
  const selectedClip = useMemo(() => {
    if (selectedClipId) {
      return clips.find(c => c.id === selectedClipId);
    }
    // Find first clip with transcript
    return clips.find(c => c.transcript && c.transcript.length > 0);
  }, [clips, selectedClipId]);

  // Get transcript from selected clip
  const transcript = selectedClip?.transcript ?? [];
  const transcriptStatus = selectedClip?.transcriptStatus ?? 'none';
  const transcriptProgress = selectedClip?.transcriptProgress ?? 0;

  // Group words into sentences/paragraphs by speaker and gaps
  const groupedTranscript = useMemo(() => {
    if (transcript.length === 0) return [];

    const groups: Array<{
      speaker: string;
      startTime: number;
      endTime: number;
      words: TranscriptWord[];
    }> = [];

    let currentGroup: typeof groups[0] | null = null;

    for (const word of transcript) {
      const speaker = word.speaker || 'Speaker 1';

      // Start new group if speaker changes or gap > 2 seconds
      if (
        !currentGroup ||
        currentGroup.speaker !== speaker ||
        word.start - currentGroup.endTime > 2
      ) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          speaker,
          startTime: word.start,
          endTime: word.end,
          words: [word],
        };
      } else {
        currentGroup.words.push(word);
        currentGroup.endTime = word.end;
      }
    }

    if (currentGroup) {
      groups.push(currentGroup);
    }

    return groups;
  }, [transcript]);

  // Filter by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedTranscript;

    const query = searchQuery.toLowerCase();
    return groupedTranscript.filter(group =>
      group.words.some(w => w.text.toLowerCase().includes(query))
    );
  }, [groupedTranscript, searchQuery]);

  // Find active group based on playhead
  const activeGroupIndex = useMemo(() => {
    if (!selectedClip) return -1;

    // Convert timeline position to clip-local time
    const clipLocalTime = playheadPosition - selectedClip.startTime + selectedClip.inPoint;

    return filteredGroups.findIndex(
      group => clipLocalTime >= group.startTime && clipLocalTime <= group.endTime
    );
  }, [filteredGroups, playheadPosition, selectedClip]);

  // Handle click on transcript entry - seek to that time
  const handleEntryClick = useCallback((sourceTime: number) => {
    if (!selectedClip) return;

    // Convert source time to timeline position
    const timelinePosition = selectedClip.startTime + (sourceTime - selectedClip.inPoint);
    setPlayheadPosition(Math.max(0, timelinePosition));
  }, [selectedClip, setPlayheadPosition]);

  // Auto-scroll to active entry
  useEffect(() => {
    if (activeGroupIndex >= 0 && containerRef.current) {
      const activeElement = containerRef.current.querySelector('.transcript-entry.active');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeGroupIndex]);

  // Handle transcribe button click
  const handleTranscribe = useCallback(async () => {
    if (!selectedClipId) return;

    // Import and call transcription
    const { transcribeClip } = await import('../../services/clipTranscriber');
    await transcribeClip(selectedClipId);
  }, [selectedClipId]);

  // Render empty state
  if (!selectedClip) {
    return (
      <div className="transcript-panel">
        <div className="transcript-header">
          <h2>Transcript</h2>
        </div>
        <div className="transcript-empty">
          <p>Select a clip to view or generate transcript</p>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript-panel">
      {/* Header */}
      <div className="transcript-header">
        <h2>Transcript</h2>
        <div className="transcript-header-actions">
          <label className="marker-toggle" title="Show word markers on timeline">
            <input
              type="checkbox"
              checked={showMarkersGlobal}
              onChange={(e) => setShowMarkersGlobal(e.target.checked)}
            />
            <span>Markers</span>
          </label>
        </div>
      </div>

      {/* Search */}
      <div className="transcript-search">
        <input
          type="text"
          placeholder="Search transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className="search-clear"
            onClick={() => setSearchQuery('')}
          >
            x
          </button>
        )}
      </div>

      {/* Clip info */}
      <div className="transcript-clip-info">
        <span className="clip-name" title={selectedClip.name}>
          {selectedClip.name}
        </span>
        {transcriptStatus === 'transcribing' && (
          <span className="transcript-status transcribing">
            Transcribing... {transcriptProgress}%
          </span>
        )}
        {transcriptStatus === 'ready' && (
          <span className="transcript-status ready">
            {transcript.length} words
          </span>
        )}
        {transcriptStatus === 'error' && (
          <span className="transcript-status error">
            Error
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="transcript-actions">
        {transcriptStatus !== 'ready' && transcriptStatus !== 'transcribing' && (
          <button
            className="btn-transcribe"
            onClick={handleTranscribe}
            disabled={transcriptStatus === 'transcribing'}
          >
            {transcriptStatus === 'transcribing' ? 'Transcribing...' : 'Transcribe'}
          </button>
        )}
        {transcriptStatus === 'ready' && (
          <button
            className="btn-transcribe btn-secondary"
            onClick={handleTranscribe}
          >
            Re-transcribe
          </button>
        )}
      </div>

      {/* Progress bar */}
      {transcriptStatus === 'transcribing' && (
        <div className="transcript-progress">
          <div
            className="transcript-progress-bar"
            style={{ width: `${transcriptProgress}%` }}
          />
        </div>
      )}

      {/* Transcript content */}
      <div className="transcript-content" ref={containerRef}>
        {filteredGroups.length === 0 ? (
          <div className="transcript-empty">
            {transcript.length === 0 ? (
              <p>No transcript available. Click "Transcribe" to generate.</p>
            ) : (
              <p>No results found for "{searchQuery}"</p>
            )}
          </div>
        ) : (
          filteredGroups.map((group, index) => (
            <TranscriptEntry
              key={`${group.startTime}-${index}`}
              words={group.words}
              speaker={group.speaker}
              startTime={group.startTime}
              endTime={group.endTime}
              isActive={index === activeGroupIndex}
              onClick={handleEntryClick}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="transcript-footer">
        <span className="transcript-hint">
          Click entry to seek. Right-click clip to transcribe.
        </span>
      </div>
    </div>
  );
}
