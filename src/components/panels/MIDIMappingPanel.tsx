import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { useMIDI } from '../../hooks/useMIDI';
import { useTimelineStore } from '../../stores/timeline';
import {
  collectMIDIMappingSummary,
  getMarkerTargetLabel,
  type MIDIMappingSummaryEntry,
} from '../../services/midi/midiMappingSummary';
import {
  moveMarkerMIDIBinding,
  setMarkerMIDIBinding,
  setTransportMIDIBinding,
} from '../../services/midi/midiBindingMutations';
import {
  triggerMIDITransportAction,
  triggerMarkerMIDIAction,
} from '../../services/midi/midiCommands';
import {
  describeMIDILearnTarget,
  getMIDINoteName,
  type MarkerMIDIAction,
  type MIDITransportAction,
} from '../../types/midi';
import './MIDIMappingPanel.css';

function MIDIMappingEmptyState({ isEnabled }: { isEnabled: boolean }) {
  return (
    <div className="midi-mapping-empty">
      <p>No MIDI mappings assigned yet.</p>
      <p>
        Add transport bindings in Settings / MIDI and marker bindings from the timeline marker right-click menu.
      </p>
      {!isEnabled && (
        <p className="midi-mapping-empty-muted">
          MIDI is currently disabled. Enable it in Settings before learning new notes.
        </p>
      )}
    </div>
  );
}

interface MIDIMappingDraft {
  mappingId: string;
  channel: string;
  note: string;
  markerId?: string;
}

function clampInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export function MIDIMappingPanel() {
  const {
    transportBindings,
    isEnabled,
    connectionStatus,
    devices,
    learnTarget,
    startLearningTransportBinding,
    startLearningMarkerBinding,
    cancelLearning,
  } = useMIDI();
  const markers = useTimelineStore((state) => state.markers);
  const [draft, setDraft] = useState<MIDIMappingDraft | null>(null);
  const [previewingMappingId, setPreviewingMappingId] = useState<string | null>(null);
  const previewResetTimeoutRef = useRef<number | null>(null);

  const mappings = useMemo(
    () => collectMIDIMappingSummary(transportBindings, markers),
    [markers, transportBindings]
  );
  const learnDescription = describeMIDILearnTarget(learnTarget);

  useEffect(() => () => {
    if (previewResetTimeoutRef.current !== null) {
      window.clearTimeout(previewResetTimeoutRef.current);
    }
  }, []);

  const stopEventPropagation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const flashPreviewState = (mappingId: string) => {
    if (previewResetTimeoutRef.current !== null) {
      window.clearTimeout(previewResetTimeoutRef.current);
    }

    setPreviewingMappingId(mappingId);
    previewResetTimeoutRef.current = window.setTimeout(() => {
      setPreviewingMappingId((current) => (current === mappingId ? null : current));
      previewResetTimeoutRef.current = null;
    }, 900);
  };

  const resolvePreviewMarkerTime = (mapping: MIDIMappingSummaryEntry): number | undefined => {
    if (mapping.scope !== 'marker') {
      return undefined;
    }

    if (draft?.mappingId === mapping.id) {
      const draftMarkerId = draft.markerId ?? mapping.markerId;
      return markers.find((marker) => marker.id === draftMarkerId)?.time;
    }

    return mapping.markerTime;
  };

  const previewMapping = (mapping: MIDIMappingSummaryEntry) => {
    flashPreviewState(mapping.id);

    if (mapping.scope === 'transport') {
      void triggerMIDITransportAction(mapping.action as MIDITransportAction);
      return;
    }

    const previewMarkerTime = resolvePreviewMarkerTime(mapping);
    if (previewMarkerTime === undefined) {
      return;
    }

    void triggerMarkerMIDIAction(mapping.action as MarkerMIDIAction, previewMarkerTime);
  };

  const handleMappingCardKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    mapping: MIDIMappingSummaryEntry
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    previewMapping(mapping);
  };

  const openEditor = (mapping: MIDIMappingSummaryEntry) => {
    setDraft({
      mappingId: mapping.id,
      channel: String(mapping.binding.channel),
      note: String(mapping.binding.note),
      markerId: mapping.markerId,
    });
  };

  const closeEditor = () => {
    setDraft(null);
  };

  const clearMapping = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'transport') {
      setTransportMIDIBinding(mapping.action as MIDITransportAction, null);
    } else if (mapping.markerId) {
      setMarkerMIDIBinding(mapping.markerId, mapping.action as MarkerMIDIAction, null);
    }

    const sourceMarkerId =
      learnTarget?.kind === 'marker'
        ? learnTarget.sourceMarkerId ?? learnTarget.markerId
        : null;
    const isLearningCurrentMapping =
      (learnTarget?.kind === 'transport'
        && mapping.scope === 'transport'
        && learnTarget.action === mapping.action)
      || (
        learnTarget?.kind === 'marker'
        && mapping.scope === 'marker'
        && learnTarget.action === mapping.action
        && sourceMarkerId === mapping.markerId
      );

    if (isLearningCurrentMapping) {
      cancelLearning();
    }

    if (draft?.mappingId === mapping.id) {
      closeEditor();
    }
  };

  const saveDraft = (mapping: MIDIMappingSummaryEntry) => {
    if (!draft || draft.mappingId !== mapping.id) {
      return;
    }

    const nextBinding = {
      channel: clampInteger(draft.channel, mapping.binding.channel, 1, 16),
      note: clampInteger(draft.note, mapping.binding.note, 0, 127),
    };

    if (mapping.scope === 'transport') {
      setTransportMIDIBinding(mapping.action as MIDITransportAction, nextBinding);
      closeEditor();
      return;
    }

    const nextMarkerId = draft.markerId ?? mapping.markerId;
    if (!nextMarkerId || !mapping.markerId) {
      return;
    }

    if (nextMarkerId !== mapping.markerId) {
      moveMarkerMIDIBinding({
        fromMarkerId: mapping.markerId,
        toMarkerId: nextMarkerId,
        action: mapping.action as MarkerMIDIAction,
        binding: nextBinding,
      });
    } else {
      setMarkerMIDIBinding(nextMarkerId, mapping.action as MarkerMIDIAction, nextBinding);
    }

    closeEditor();
  };

  const startLearningForMapping = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'transport') {
      startLearningTransportBinding(mapping.action as MIDITransportAction);
      return;
    }

    const targetMarkerId =
      draft?.mappingId === mapping.id
        ? draft.markerId ?? mapping.markerId
        : mapping.markerId;

    if (!targetMarkerId || !mapping.markerId) {
      return;
    }

    const marker = markers.find((candidate) => candidate.id === targetMarkerId);
    startLearningMarkerBinding(
      targetMarkerId,
      marker?.label.trim() || 'Marker',
      mapping.action as MarkerMIDIAction,
      mapping.markerId
    );
  };

  return (
    <div className="midi-mapping-panel">
      <div className="midi-mapping-header">
        <div>
          <h2>MIDI Mapping</h2>
          <p>All assigned MIDI notes and their linked editor commands. Click a mapping card to preview its trigger.</p>
        </div>
        <div className="midi-mapping-status">
          <span className={`midi-mapping-status-dot ${isEnabled && connectionStatus === 'connected' ? 'is-live' : ''}`} />
          <span>
            {isEnabled ? 'MIDI On' : 'MIDI Off'}
            {devices.length > 0 ? `, ${devices.length} device${devices.length > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>

      {learnDescription && (
        <div className="midi-mapping-learn-banner">
          <span>{learnDescription}</span>
          <button className="settings-button" onClick={cancelLearning}>
            Cancel Learn
          </button>
        </div>
      )}

      {mappings.length === 0 ? (
        <MIDIMappingEmptyState isEnabled={isEnabled} />
      ) : (
        <div className="midi-mapping-list">
          {mappings.map((mapping) => {
            const isEditing = draft?.mappingId === mapping.id;
            const channelValue = isEditing ? draft.channel : String(mapping.binding.channel);
            const noteValue = isEditing ? draft.note : String(mapping.binding.note);
            const selectedMarkerId = isEditing ? draft.markerId ?? mapping.markerId : mapping.markerId;
            const isPreviewable = mapping.scope === 'transport' || mapping.markerTime !== undefined;
            const notePreview = getMIDINoteName(
              clampInteger(noteValue, mapping.binding.note, 0, 127)
            );
            const sourceMarkerId =
              learnTarget?.kind === 'marker'
                ? learnTarget.sourceMarkerId ?? learnTarget.markerId
                : null;
            const isLearningCurrentMapping =
              (learnTarget?.kind === 'transport'
                && mapping.scope === 'transport'
                && learnTarget.action === mapping.action)
              || (
                learnTarget?.kind === 'marker'
                && mapping.scope === 'marker'
                && learnTarget.action === mapping.action
                && sourceMarkerId === mapping.markerId
              );

            return (
              <div
                key={mapping.id}
                className={`midi-mapping-card${isPreviewable && !isEditing ? ' is-clickable' : ''}${previewingMappingId === mapping.id ? ' is-previewing' : ''}`}
                role={isPreviewable && !isEditing ? 'button' : undefined}
                tabIndex={isPreviewable && !isEditing ? 0 : undefined}
                onClick={isPreviewable && !isEditing ? () => previewMapping(mapping) : undefined}
                onKeyDown={isPreviewable && !isEditing ? (event) => handleMappingCardKeyDown(event, mapping) : undefined}
                aria-label={isPreviewable && !isEditing ? `Preview ${mapping.actionLabel}` : undefined}
              >
                <div className="midi-mapping-card-top">
                  <span className="midi-mapping-binding">{mapping.bindingLabel}</span>
                  <span className={`midi-mapping-scope midi-mapping-scope-${mapping.scope}`}>
                    {mapping.scope === 'transport' ? 'Transport' : 'Marker'}
                  </span>
                </div>
                <div className="midi-mapping-card-main">
                  <strong>{mapping.actionLabel}</strong>
                  <span>{mapping.targetLabel}</span>
                </div>
                <div className="midi-mapping-card-footer">
                  <span>{mapping.behaviorLabel}</span>
                  {!isEditing && (
                    <div
                      className="midi-mapping-card-actions"
                      onClick={stopEventPropagation}
                      onKeyDown={stopEventPropagation}
                    >
                      <button className="settings-button" onClick={() => openEditor(mapping)}>
                        Edit
                      </button>
                      <button className="settings-button" onClick={() => startLearningForMapping(mapping)}>
                        {isLearningCurrentMapping ? 'Listening...' : 'Learn'}
                      </button>
                      <button className="settings-button" onClick={() => clearMapping(mapping)}>
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div
                    className="midi-mapping-editor"
                    onClick={stopEventPropagation}
                    onKeyDown={stopEventPropagation}
                  >
                    <div className="midi-mapping-editor-grid">
                      <label className="midi-mapping-field">
                        <span>Channel</span>
                        <input
                          type="number"
                          min={1}
                          max={16}
                          value={channelValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                              ? { ...currentDraft, channel: value }
                              : currentDraft
                            );
                          }}
                        />
                      </label>

                      <label className="midi-mapping-field">
                        <span>Note</span>
                        <input
                          type="number"
                          min={0}
                          max={127}
                          value={noteValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                              ? { ...currentDraft, note: value }
                              : currentDraft
                            );
                          }}
                        />
                        <small>{notePreview}</small>
                      </label>

                      {mapping.scope === 'marker' && (
                        <label className="midi-mapping-field midi-mapping-field-wide">
                          <span>Marker</span>
                          <select
                            value={selectedMarkerId ?? ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                                ? { ...currentDraft, markerId: value }
                                : currentDraft
                              );
                            }}
                          >
                            {markers.map((marker) => (
                              <option key={marker.id} value={marker.id}>
                                {getMarkerTargetLabel(marker)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    <div className="midi-mapping-editor-actions">
                      <button className="settings-button" onClick={() => saveDraft(mapping)}>
                        Save
                      </button>
                      <button className="settings-button" onClick={() => previewMapping(mapping)}>
                        Trigger
                      </button>
                      <button className="settings-button" onClick={() => startLearningForMapping(mapping)}>
                        {isLearningCurrentMapping ? 'Listening...' : 'Learn'}
                      </button>
                      <button className="settings-button" onClick={() => clearMapping(mapping)}>
                        Clear
                      </button>
                      <button className="settings-button" onClick={closeEditor}>
                        Cancel
                      </button>
                    </div>

                    <p className="midi-mapping-editor-hint">
                      Notes stay unique across transport and marker mappings. Saving or learning here replaces any existing assignment using the same channel and note.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
