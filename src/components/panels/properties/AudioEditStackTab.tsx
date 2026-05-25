import { useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import type { ClipAudioEditOperation } from '../../../types';

const OPERATION_LABELS: Record<ClipAudioEditOperation['type'], string> = {
  trim: 'Trim',
  cut: 'Cut',
  silence: 'Silence',
  copy: 'Copy',
  paste: 'Paste',
  'insert-silence': 'Insert Silence',
  'delete-silence': 'Delete Silence',
  reverse: 'Reverse',
  'invert-polarity': 'Invert Polarity',
  'swap-channels': 'Swap Channels',
  'mono-sum': 'Mono Sum',
  'split-stereo': 'Split Stereo',
  repair: 'Repair',
  'spectral-mask': 'Spectral Mask',
  'spectral-resynthesis': 'Spectral Resynthesis',
};

function formatSeconds(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute - minutes * 60;
  return `${sign}${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

function getOperationLabel(operation: ClipAudioEditOperation): string {
  const label = operation.params?.label;
  if (typeof label === 'string' && label.trim()) return label;
  return OPERATION_LABELS[operation.type] ?? operation.type;
}

function getOperationRange(operation: ClipAudioEditOperation): string {
  if (!operation.timeRange) return '-';
  return `${formatSeconds(operation.timeRange.start)} - ${formatSeconds(operation.timeRange.end)}`;
}

function getTimelineRange(operation: ClipAudioEditOperation): string {
  const start = operation.params?.timelineStart;
  const end = operation.params?.timelineEnd;
  if (typeof start !== 'number' || typeof end !== 'number') return '-';
  return `${formatSeconds(start)} - ${formatSeconds(end)}`;
}

interface AudioEditStackTabProps {
  clipId: string;
}

export function AudioEditStackTab({ clipId }: AudioEditStackTabProps) {
  const clip = useTimelineStore(state => state.clips.find(currentClip => currentClip.id === clipId));
  const setClipAudioEditOperationEnabled = useTimelineStore(state => state.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(state => state.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(state => state.clearClipAudioEditStack);
  const bakeClipAudioEditStack = useTimelineStore(state => state.bakeClipAudioEditStack);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [baking, setBaking] = useState(false);

  const editStack = useMemo(() => clip?.audioState?.editStack ?? [], [clip?.audioState?.editStack]);
  const bakeHistory = clip?.audioState?.bakeHistory ?? [];
  const activeOperationCount = editStack.filter(operation => operation.enabled !== false).length;
  const selectedOperation = editStack.find(operation => operation.id === selectedOperationId) ?? editStack[0] ?? null;

  useEffect(() => {
    if (selectedOperationId && editStack.some(operation => operation.id === selectedOperationId)) return;
    setSelectedOperationId(editStack[0]?.id ?? null);
  }, [editStack, selectedOperationId]);

  if (!clip) {
    return (
      <div className="properties-tab-content audio-edit-stack-tab">
        <div className="panel-empty"><p>Select an audio clip</p></div>
      </div>
    );
  }

  const handleBake = async () => {
    if (baking || activeOperationCount === 0) return;
    setBaking(true);
    try {
      await bakeClipAudioEditStack(clip.id);
    } finally {
      setBaking(false);
    }
  };

  return (
    <div className="properties-tab-content audio-edit-stack-tab">
      <div className="audio-edit-stack-header">
        <div className="audio-edit-stack-title">
          <span>{activeOperationCount} active</span>
          <span>{editStack.length} total</span>
        </div>
        <div className="audio-edit-stack-actions">
          <button className="btn btn-sm" onClick={handleBake} disabled={baking || activeOperationCount === 0}>
            {baking ? 'Baking...' : 'Bake'}
          </button>
          <button className="btn btn-sm" onClick={() => clearClipAudioEditStack(clip.id)} disabled={editStack.length === 0}>
            Clear
          </button>
        </div>
      </div>

      {editStack.length === 0 ? (
        <div className="panel-empty"><p>No audio edits applied</p></div>
      ) : (
        <div className="audio-edit-stack-layout">
          <div className="audio-edit-operation-list">
            {editStack.map((operation, index) => {
              const enabled = operation.enabled !== false;
              const selected = selectedOperation?.id === operation.id;
              return (
                <button
                  type="button"
                  key={operation.id}
                  className={`audio-edit-operation-row ${selected ? 'selected' : ''} ${enabled ? '' : 'bypassed'}`}
                  onClick={() => setSelectedOperationId(operation.id)}
                >
                  <span className="audio-edit-operation-index">{index + 1}</span>
                  <span className="audio-edit-operation-main">
                    <span className="audio-edit-operation-name">{getOperationLabel(operation)}</span>
                    <span className="audio-edit-operation-range">{getOperationRange(operation)}</span>
                  </span>
                  <span className="audio-edit-operation-state">{enabled ? 'On' : 'Off'}</span>
                </button>
              );
            })}
          </div>

          {selectedOperation && (
            <div className="audio-edit-operation-detail">
              <div className="audio-edit-detail-header">
                <div>
                  <h4>{getOperationLabel(selectedOperation)}</h4>
                  <span>{selectedOperation.type}</span>
                </div>
                <div className="audio-edit-detail-actions">
                  <button
                    className="btn btn-sm"
                    onClick={() => setClipAudioEditOperationEnabled(clip.id, selectedOperation.id, selectedOperation.enabled === false)}
                  >
                    {selectedOperation.enabled === false ? 'Enable' : 'Bypass'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => removeClipAudioEditOperation(clip.id, selectedOperation.id)}>
                    Remove
                  </button>
                </div>
              </div>

              <div className="audio-edit-detail-grid">
                <span>Source</span>
                <strong>{getOperationRange(selectedOperation)}</strong>
                <span>Timeline</span>
                <strong>{getTimelineRange(selectedOperation)}</strong>
                <span>Channels</span>
                <strong>{selectedOperation.channelMask?.length ? selectedOperation.channelMask.join(', ') : 'All'}</strong>
                <span>Created</span>
                <strong>{new Date(selectedOperation.createdAt).toLocaleString()}</strong>
              </div>

              <div className="audio-edit-param-list">
                {Object.entries(selectedOperation.params ?? {}).map(([key, value]) => (
                  <div key={key} className="audio-edit-param-row">
                    <span>{key}</span>
                    <strong>{formatValue(value)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {bakeHistory.length > 0 && (
        <div className="audio-edit-bake-history">
          <h4>Bakes</h4>
          {bakeHistory.slice().reverse().map((entry) => (
            <div key={entry.id} className="audio-edit-bake-row">
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
              <strong>{entry.operationIds.length} ops</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
