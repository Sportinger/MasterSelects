import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { IconEye, IconEyeOff, IconGripVertical, IconX } from '@tabler/icons-react';
import { isFillerToken } from '../../../services/audio/intelligence/speechMarkers/fillerLexicon';
import type {
  CaptionTimelineTranscriptEvent,
  CaptionTimelineWordEvent,
} from '../../../services/captions/captionTimelineTranscript';
import type { TranscriptReviewOmission } from '../../../services/captions/transcriptReviewEdits';
import './CaptionTab.css';

interface TranscriptActionResult {
  error?: string;
  ok: boolean;
}

export interface TranscriptRangeMoveRequest {
  end: number;
  events: readonly CaptionTimelineTranscriptEvent[];
  start: number;
  targetTime: number;
}

interface TimelineTranscriptEditorProps {
  ariaLabel?: string;
  emptyMessage?: string;
  events: readonly CaptionTimelineTranscriptEvent[];
  helpMessage?: string;
  omissions?: readonly TranscriptReviewOmission[];
  onCorrectWord: (event: CaptionTimelineWordEvent, text: string) => TranscriptActionResult;
  onDeleteRange: (event: CaptionTimelineTranscriptEvent, label: string) => TranscriptActionResult;
  onMoveRange?: (request: TranscriptRangeMoveRequest) => TranscriptActionResult;
  onRestoreOmission?: (omissionId: string) => TranscriptActionResult;
  playheadPosition: number;
  setPlayheadPosition: (time: number) => void;
}

interface WordEditState { draft: string; eventKey: string }
interface TranscriptContextMenuState { eventKey: string; x: number; y: number }

function eventAtPlayhead(event: CaptionTimelineTranscriptEvent, time: number): boolean {
  return time >= event.timelineStart && time < event.timelineEnd;
}

function formatPauseDuration(seconds: number): string {
  return seconds < 1 ? seconds.toFixed(1) : seconds.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '');
}

function hasCutBefore(events: readonly CaptionTimelineTranscriptEvent[], index: number): boolean {
  const event = events[index];
  if (event?.kind !== 'word') return false;
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const previous = events[previousIndex];
    if (previous.kind === 'word') return previous.sourceClipId !== event.sourceClipId;
  }
  return false;
}

function selectionRange(
  selectedKeys: ReadonlySet<string>,
  events: readonly CaptionTimelineTranscriptEvent[],
): { end: number; events: CaptionTimelineTranscriptEvent[]; start: number } | null {
  const selected = events.filter(event => selectedKeys.has(event.key));
  if (selected.length === 0) return null;
  const start = Math.min(...selected.map(event => event.timelineStart));
  const end = Math.max(...selected.map(event => event.timelineEnd));
  return {
    end,
    events: events.filter(event => event.timelineEnd > start && event.timelineStart < end),
    start,
  };
}

export function TimelineTranscriptEditor({
  ariaLabel = 'Timeline transcript',
  emptyMessage = 'No transcript words are visible in this edit.',
  events,
  helpMessage = 'Click to seek · Shift-click selects a range · Double-click edits · X removes a word or pause.',
  omissions = [],
  onCorrectWord,
  onDeleteRange,
  onMoveRange,
  onRestoreOmission,
  playheadPosition,
  setPlayheadPosition,
}: TimelineTranscriptEditorProps) {
  const [editing, setEditing] = useState<WordEditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TranscriptContextMenuState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [moveTargetDraft, setMoveTargetDraft] = useState('');
  const [showOmissions, setShowOmissions] = useState(false);
  const anchorIndexRef = useRef<number | null>(null);
  const activeEventRef = useRef<HTMLElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const finishedEditRef = useRef(false);
  const activeKey = events.find(event => eventAtPlayhead(event, playheadPosition))?.key;
  const supportsRestore = Boolean(onRestoreOmission);
  const selectedRange = useMemo(() => selectionRange(selectedKeys, events), [events, selectedKeys]);
  const visibleItems = useMemo(() => [
    ...events.map(event => ({ event, key: event.key, start: event.timelineStart, type: 'event' as const })),
    ...(showOmissions
      ? omissions.map(omission => ({ key: omission.id, omission, start: omission.timelineStart, type: 'omission' as const }))
      : []),
  ].toSorted((left, right) => left.start - right.start || left.key.localeCompare(right.key)), [events, omissions, showOmissions]);
  const omissionLabel = `${omissions.length} removed ${omissions.length === 1 ? 'word or pause' : 'words and pauses'}`;
  const displayedHelpMessage = supportsRestore
    ? 'Click to select · Shift-click selects a range · Double-click edits · Right-click removes · The first eye shows your removed words and pauses.'
    : helpMessage;

  useEffect(() => {
    if (!editing) return;
    window.requestAnimationFrame(() => { editInputRef.current?.focus({ preventScroll: true }); editInputRef.current?.select(); });
  }, [editing]);

  useEffect(() => { if (activeKey) activeEventRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeKey]);
  useEffect(() => {
    let cancelled = false;
    const validKeys = new Set(events.map(event => event.key));
    queueMicrotask(() => {
      if (cancelled) return;
      setEditing(current => current && !validKeys.has(current.eventKey) ? null : current);
      setSelectedKeys(current => {
        const next = new Set([...current].filter(key => validKeys.has(key)));
        return next.size === current.size ? current : next;
      });
    });
    return () => { cancelled = true; };
  }, [events]);
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', handleKeyDown); };
  }, [contextMenu]);

  const deleteRange = (event: CaptionTimelineTranscriptEvent, label: string): boolean => {
    const result = onDeleteRange(event, label);
    if (!result.ok) { setError(result.error ?? 'The timeline range could not be removed.'); return false; }
    setSelectedKeys(new Set());
    setError(null);
    return true;
  };

  const finishWordEdit = (deleteIfEmpty: boolean) => {
    if (!editing) return;
    const event = events.find(candidate => candidate.kind === 'word' && candidate.key === editing.eventKey);
    if (!event || event.kind !== 'word') { setEditing(null); return; }
    const text = editing.draft.trim();
    if (!text) { if (deleteIfEmpty && !deleteRange(event, 'Hide transcript word')) return; setEditing(null); return; }
    const result = onCorrectWord(event, text);
    if (!result.ok) { setError(result.error ?? 'The transcript word could not be updated.'); return; }
    setEditing(null); setError(null);
  };

  const handleEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); finishedEditRef.current = true; setEditing(null); }
    if (event.key === 'Enter') { event.preventDefault(); finishedEditRef.current = true; finishWordEdit(true); }
  };

  const selectEvent = (event: CaptionTimelineTranscriptEvent, index: number, shiftKey: boolean) => {
    if (!shiftKey) {
      anchorIndexRef.current = index;
      setSelectedKeys(current => {
        const next = new Set(current);
        if (next.size === 1 && next.has(event.key)) next.clear(); else { next.clear(); next.add(event.key); }
        return next;
      });
      return;
    }
    const anchorIndex = anchorIndexRef.current ?? index;
    const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
    setSelectedKeys(new Set(events.slice(from, to + 1).map(candidate => candidate.key)));
  };

  const openContextMenu = (event: ReactMouseEvent, transcriptEvent: CaptionTimelineTranscriptEvent) => {
    event.preventDefault(); event.stopPropagation();
    setContextMenu({ eventKey: transcriptEvent.key, x: Math.min(event.clientX, window.innerWidth - 175), y: Math.min(event.clientY, window.innerHeight - 48) });
  };
  const contextEvent = contextMenu ? events.find(event => event.key === contextMenu.eventKey) : undefined;

  const moveSelection = (targetTime: number) => {
    if (!selectedRange || !onMoveRange) return;
    if (!Number.isFinite(targetTime) || targetTime < 0) { setError('Enter a valid destination time in seconds.'); return; }
    const result = onMoveRange({ ...selectedRange, targetTime });
    if (!result.ok) { setError(result.error ?? 'The selected range could not be moved.'); return; }
    setSelectedKeys(new Set()); setMoveTargetDraft(''); setError(null);
  };

  const submitMove = () => moveSelection(Number(moveTargetDraft));

  return (
    <div className="caption-transcript-body">
      {supportsRestore && (
        <div className="caption-transcript-view-toolbar" aria-label="Transcript view options" role="group">
          <button
            aria-label={`${showOmissions ? 'Hide' : 'Show'} ${omissionLabel}`}
            aria-pressed={showOmissions}
            className="caption-transcript-view-toggle"
            disabled={omissions.length === 0}
            onClick={() => setShowOmissions(current => !current)}
            title={`${showOmissions ? 'Hide' : 'Show'} words and pauses removed by you`}
            type="button"
          >
            {showOmissions ? <IconEyeOff aria-hidden="true" /> : <IconEye aria-hidden="true" />}
          </button>
          <button
            aria-label="Show the complete source transcript (coming later)"
            className="caption-transcript-view-toggle"
            disabled
            title="Complete source transcript · coming later"
            type="button"
          >
            <IconEye aria-hidden="true" />
          </button>
        </div>
      )}
      {visibleItems.length === 0 ? <p className="properties-hint caption-transcript-empty">{emptyMessage}</p> : (
        <div className="caption-transcript-events" aria-label={ariaLabel}>
          {visibleItems.map(item => {
            if (item.type === 'omission') {
              const omission = item.omission;
              return (
                <span className={`caption-transcript-omission is-${omission.kind}`} key={omission.id}>
                  <button
                    aria-label={`Restore ${omission.text}`}
                    className="caption-transcript-omission-restore"
                    disabled={!onRestoreOmission}
                    type="button"
                    onClick={() => {
                      const result = onRestoreOmission?.(omission.id);
                      if (result && !result.ok) setError(result.error ?? 'The range could not be restored.'); else setError(null);
                    }}
                    title="Restore this word or pause to the video"
                  >{omission.text}</button>
                </span>
              );
            }
            const event = item.event;
            const index = events.findIndex(candidate => candidate.key === event.key);
            const active = event.key === activeKey;
            const selected = selectedKeys.has(event.key);
            const edit = editing?.eventKey === event.key ? editing : null;
            if (event.kind === 'pause') {
              const duration = event.timelineEnd - event.timelineStart;
              return (
                <span key={event.key} ref={active ? element => { activeEventRef.current = element; } : undefined} className={`caption-transcript-pause${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`} onContextMenu={menuEvent => openContextMenu(menuEvent, event)}>
                  <button type="button" className="caption-transcript-pause-label" onClick={click => { selectEvent(event, index, click.shiftKey); setPlayheadPosition(event.timelineStart); }} title="Click to select · Shift-click for range">Pause {formatPauseDuration(duration)}s</button>
                  {!supportsRestore && <button type="button" className="caption-transcript-visibility" aria-label={`Delete ${formatPauseDuration(duration)} second pause`} onClick={() => deleteRange(event, 'Delete transcript pause')} title="Delete this pause from video and linked audio"><IconX aria-hidden="true" /></button>}
                </span>
              );
            }
            const isFiller = isFillerToken(event.text);
            return (
              <Fragment key={event.key}>
                {hasCutBefore(events, index) && <span className="caption-transcript-cut-boundary" aria-label="Timeline cut" title="Timeline cut" />}
                {edit ? (
                  <input ref={editInputRef} className="caption-transcript-word-input" value={edit.draft} aria-label={`Edit transcript word ${event.text}`} onBlur={() => { if (finishedEditRef.current) { finishedEditRef.current = false; return; } finishWordEdit(false); }} onChange={change => setEditing({ eventKey: event.key, draft: change.target.value })} onKeyDown={handleEditKeyDown} onContextMenu={menuEvent => openContextMenu(menuEvent, event)} />
                ) : (
                  <span className={`caption-transcript-word-shell${selected ? ' is-selected' : ''}`}>
                    <button ref={active ? element => { activeEventRef.current = element; } : undefined} type="button" className={`caption-transcript-word${active ? ' is-active' : ''}${isFiller ? ' is-filler' : ''}`} onClick={click => { selectEvent(event, index, click.shiftKey); setPlayheadPosition(event.timelineStart); }} onDoubleClick={() => { finishedEditRef.current = false; setError(null); setEditing({ eventKey: event.key, draft: event.text }); }} onContextMenu={menuEvent => openContextMenu(menuEvent, event)} title="Click to select · Shift-click for range · Double-click to edit">{event.text}</button>
                    {!supportsRestore && <button type="button" className="caption-transcript-visibility" aria-label={`Delete ${event.text}`} onClick={() => deleteRange(event, 'Delete transcript word')} title="Delete this word from video and linked audio"><IconX aria-hidden="true" /></button>}
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
      {selectedRange && onMoveRange && (
        <div className="caption-transcript-range-actions">
          <IconGripVertical aria-hidden="true" />
          <span>{selectedRange.events.length} selected · {formatPauseDuration(selectedRange.end - selectedRange.start)}s</span>
          <button type="button" onClick={() => moveSelection(playheadPosition)}>Move to playhead</button>
          <label>Move to <input aria-label="Move selected transcript range to seconds" inputMode="decimal" min="0" placeholder="seconds" step="0.1" type="number" value={moveTargetDraft} onChange={event => setMoveTargetDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitMove(); }} /></label>
          <button type="button" onClick={submitMove}>Move</button>
          <button type="button" onClick={() => setSelectedKeys(new Set())}>Cancel</button>
        </div>
      )}
      {error && <p className="caption-transcript-error" role="alert">{error}</p>}
      <p className="properties-hint caption-transcript-help">{displayedHelpMessage}</p>
      {contextMenu && contextEvent && createPortal(
        <div className="caption-transcript-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
          <button type="button" className="caption-transcript-context-action danger" role="menuitem" onClick={() => { deleteRange(contextEvent, contextEvent.kind === 'pause' ? 'Hide transcript pause' : 'Hide transcript word'); setContextMenu(null); }}>Hide from timeline</button>
        </div>, document.body,
      )}
    </div>
  );
}
