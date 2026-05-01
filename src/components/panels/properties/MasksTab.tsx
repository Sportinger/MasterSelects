// Masks Tab - focused clip mask creation and editing controls
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  getNextMaskVertexHandleMode,
  inferMaskVertexHandleMode,
} from '../../../utils/maskVertexHandles';
import type { MaskMode, ClipMask, MaskVertexHandleMode } from '../../../types';
import { DraggableNumber } from './shared';
import { MIDIParameterLabel } from './MIDIParameterLabel';

const MASK_MODES: { value: MaskMode; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

type IconName =
  | 'chevron'
  | 'pen'
  | 'edit'
  | 'rect'
  | 'ellipse'
  | 'eye'
  | 'eyeOff'
  | 'power'
  | 'invert'
  | 'trash'
  | 'close'
  | 'up'
  | 'down';

function MaskIcon({ name }: { name: IconName }) {
  switch (name) {
    case 'chevron':
      return <path d="M8 10l4 4 4-4" />;
    case 'pen':
      return (
        <>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <circle cx="11" cy="11" r="2" />
        </>
      );
    case 'edit':
      return (
        <>
          <path d="M4 20h16" />
          <path d="M6 16l2.5-.5L18 6a2 2 0 0 0-3-3L5.5 12.5 5 15z" />
        </>
      );
    case 'rect':
      return <rect x="4" y="5" width="16" height="14" rx="1.5" />;
    case 'ellipse':
      return <ellipse cx="12" cy="12" rx="8" ry="6" />;
    case 'eye':
      return (
        <>
          <path d="M1.5 12s4-7 10.5-7 10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
    case 'eyeOff':
      return (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.7 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10.5 7 10.5 7a16 16 0 0 1-2.8 3.6" />
          <path d="M6.1 6.5A16 16 0 0 0 1.5 12S5.5 19 12 19c1.6 0 3-.4 4.3-1" />
        </>
      );
    case 'power':
      return (
        <>
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
        </>
      );
    case 'invert':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
        </>
      );
    case 'trash':
      return (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 15h10l1-15" />
        </>
      );
    case 'close':
      return (
        <>
          <path d="M5 12a7 7 0 1 1 7 7" />
          <path d="M5 12h6v6" />
        </>
      );
    case 'up':
      return <path d="M7 14l5-5 5 5" />;
    case 'down':
      return <path d="M7 10l5 5 5-5" />;
  }
}

function IconButton({
  icon,
  title,
  active,
  disabled,
  className = '',
  onClick,
}: {
  icon: IconName;
  title: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`mask-icon-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
        <MaskIcon name={icon} />
      </svg>
    </button>
  );
}

interface MaskItemProps {
  clipId: string;
  mask: ClipMask;
  index: number;
  count: number;
  isActive: boolean;
  onSelect: () => void;
}

function MaskItem({ clipId, mask, index, count, isActive, onSelect }: MaskItemProps) {
  const { updateMask, removeMask, reorderMasks, setActiveMask, setMaskEditMode } = useTimelineStore.getState();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(mask.name);

  const commitName = () => {
    const nextName = editName.trim();
    if (nextName) updateMask(clipId, mask.id, { name: nextName });
    setIsEditing(false);
  };

  const selectForEditing = () => {
    onSelect();
    setActiveMask(clipId, mask.id);
    setMaskEditMode('editing');
  };

  return (
    <div className={`mask-item ${isActive ? 'active' : ''} ${mask.expanded ? 'expanded' : ''} ${mask.enabled === false ? 'disabled' : ''}`}>
      <div className="mask-item-header" onClick={onSelect}>
        <IconButton
          icon="chevron"
          title={mask.expanded ? 'Collapse mask' : 'Expand mask'}
          className={mask.expanded ? 'expanded' : ''}
          onClick={(e) => {
            e.stopPropagation();
            updateMask(clipId, mask.id, { expanded: !mask.expanded });
          }}
        />

        {isEditing ? (
          <input
            type="text"
            className="mask-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="mask-name"
            onDoubleClick={() => {
              setEditName(mask.name);
              setIsEditing(true);
            }}
            onClick={(e) => {
              e.stopPropagation();
              selectForEditing();
            }}
          >
            <span>{mask.name}</span>
            <small>{mask.vertices.length} pts</small>
          </button>
        )}

        <div className="mask-item-actions">
          <IconButton
            icon="power"
            title={mask.enabled === false ? 'Enable mask render' : 'Disable mask render'}
            active={mask.enabled !== false}
            onClick={(e) => {
              e.stopPropagation();
              updateMask(clipId, mask.id, { enabled: mask.enabled === false });
            }}
          />
          <IconButton
            icon={mask.visible ? 'eye' : 'eyeOff'}
            title={mask.visible ? 'Hide mask outline' : 'Show mask outline'}
            active={mask.visible}
            onClick={(e) => {
              e.stopPropagation();
              updateMask(clipId, mask.id, { visible: !mask.visible });
            }}
          />
          <IconButton
            icon="edit"
            title="Edit mask path"
            active={isActive}
            onClick={(e) => {
              e.stopPropagation();
              selectForEditing();
            }}
          />
          <IconButton
            icon="up"
            title="Move mask up"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation();
              reorderMasks(clipId, index, Math.max(0, index - 1));
            }}
          />
          <IconButton
            icon="down"
            title="Move mask down"
            disabled={index >= count - 1}
            onClick={(e) => {
              e.stopPropagation();
              reorderMasks(clipId, index, Math.min(count - 1, index + 1));
            }}
          />
          <IconButton
            icon="trash"
            title="Delete mask"
            className="danger"
            onClick={(e) => {
              e.stopPropagation();
              removeMask(clipId, mask.id);
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface MasksTabProps {
  clipId: string;
  masks: ClipMask[] | undefined;
}

export function MasksTab({ clipId, masks }: MasksTabProps) {
  const activeMaskId = useTimelineStore(state => state.activeMaskId);
  const selectedVertexIds = useTimelineStore(state => state.selectedVertexIds);
  const maskEditMode = useTimelineStore(state => state.maskEditMode);
  const {
    addRectangleMask,
    addEllipseMask,
    setActiveMask,
    setMaskEditMode,
    setMaskPanelActive,
    setMaskDragging,
    updateMask,
    closeMask,
    selectVertices,
    setVertexHandleMode,
  } = useTimelineStore.getState();
  const registry = getShortcutRegistry();

  const maskList = useMemo(() => masks || [], [masks]);
  const activeMask = useMemo(
    () => maskList.find(mask => mask.id === activeMaskId) || maskList[0] || null,
    [activeMaskId, maskList],
  );
  const selectedVertices = useMemo(
    () => activeMask?.vertices.filter(vertex => selectedVertexIds.has(vertex.id)) || [],
    [activeMask, selectedVertexIds],
  );
  const selectedHandleMode = useMemo<MaskVertexHandleMode | 'mixed' | null>(() => {
    if (selectedVertices.length === 0) return null;
    const modes = selectedVertices.map(vertex => inferMaskVertexHandleMode(vertex));
    const firstMode = modes[0] ?? 'none';
    return modes.every(mode => mode === firstMode) ? firstMode : 'mixed';
  }, [selectedVertices]);

  const handleBatchStart = useCallback(() => {
    startBatch('Adjust mask');
    setMaskDragging(true);
  }, [setMaskDragging]);
  const handleBatchEnd = useCallback(() => {
    useTimelineStore.getState().invalidateCache();
    setMaskDragging(false);
    endBatch();
  }, [setMaskDragging]);

  useEffect(() => {
    setMaskPanelActive(true);
    return () => {
      setMaskPanelActive(false);
      setMaskEditMode('none');
    };
  }, [setMaskEditMode, setMaskPanelActive]);

  useEffect(() => {
    if (!activeMask) return;
    if (useTimelineStore.getState().maskEditMode !== 'none') return;
    setActiveMask(clipId, activeMask.id);
  }, [activeMask, clipId, setActiveMask]);

  const selectMask = useCallback((maskId: string) => {
    setActiveMask(clipId, maskId);
  }, [clipId, setActiveMask]);

  const createRectangle = useCallback(() => {
    const maskId = addRectangleMask(clipId);
    setActiveMask(clipId, maskId);
  }, [addRectangleMask, clipId, setActiveMask]);

  const createEllipse = useCallback(() => {
    const maskId = addEllipseMask(clipId);
    setActiveMask(clipId, maskId);
  }, [addEllipseMask, clipId, setActiveMask]);

  const startDrawMode = useCallback((mode: 'drawingRect' | 'drawingEllipse' | 'drawingPen') => {
    setMaskEditMode(mode);
  }, [setMaskEditMode]);

  const setSelectedHandles = useCallback((mode: MaskVertexHandleMode) => {
    if (!activeMask || selectedVertices.length === 0) return;
    startBatch('Change mask vertex handles');
    setVertexHandleMode(clipId, activeMask.id, selectedVertices.map(vertex => vertex.id), mode);
    endBatch();
  }, [activeMask, clipId, selectedVertices, setVertexHandleMode]);

  const cycleSelectedHandles = useCallback(() => {
    if (!selectedHandleMode || selectedHandleMode === 'mixed') {
      setSelectedHandles('mirrored');
      return;
    }
    setSelectedHandles(getNextMaskVertexHandleMode(selectedHandleMode));
  }, [selectedHandleMode, setSelectedHandles]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (useTimelineStore.getState().maskEditMode !== 'none') return;

      if (registry.matches('mask.pen', e)) {
        e.preventDefault();
        setMaskEditMode('drawingPen');
        return;
      }
      if (registry.matches('mask.rectangle', e)) {
        e.preventDefault();
        setMaskEditMode('drawingRect');
        return;
      }
      if (registry.matches('mask.ellipse', e)) {
        e.preventDefault();
        setMaskEditMode('drawingEllipse');
        return;
      }
      if (activeMask && registry.matches('mask.edit', e)) {
        e.preventDefault();
        setActiveMask(clipId, activeMask.id);
        setMaskEditMode('editing');
        return;
      }
      if (activeMask && registry.matches('mask.closePath', e)) {
        e.preventDefault();
        if (!activeMask.closed && activeMask.vertices.length >= 3) {
          closeMask(clipId, activeMask.id);
          setMaskEditMode('editing');
        }
        return;
      }
      if (activeMask && registry.matches('mask.invert', e)) {
        e.preventDefault();
        updateMask(clipId, activeMask.id, { inverted: !activeMask.inverted });
        return;
      }
      if (activeMask && registry.matches('mask.toggleOutline', e)) {
        e.preventDefault();
        updateMask(clipId, activeMask.id, { visible: !activeMask.visible });
        return;
      }
      if (activeMask && registry.matches('mask.selectAllVertices', e)) {
        e.preventDefault();
        setActiveMask(clipId, activeMask.id);
        selectVertices(activeMask.vertices.map(vertex => vertex.id));
        return;
      }
      if (activeMask && selectedVertices.length > 0 && registry.matches('mask.toggleVertexHandles', e)) {
        e.preventDefault();
        cycleSelectedHandles();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeMask,
    clipId,
    closeMask,
    registry,
    selectVertices,
    selectedVertices.length,
    setActiveMask,
    setMaskEditMode,
    updateMask,
    cycleSelectedHandles,
  ]);

  return (
    <div className="properties-tab-content masks-tab">
      <div className="mask-toolbar">
        <div className="mask-toolbar-group">
          <IconButton
            icon="pen"
            title={`Pen Tool (${registry.getLabel('mask.pen')})`}
            active={maskEditMode === 'drawingPen'}
            onClick={() => startDrawMode('drawingPen')}
          />
          <IconButton
            icon="rect"
            title={`Draw Rectangle (${registry.getLabel('mask.rectangle')})`}
            active={maskEditMode === 'drawingRect'}
            onClick={() => startDrawMode('drawingRect')}
          />
          <IconButton
            icon="ellipse"
            title={`Draw Ellipse (${registry.getLabel('mask.ellipse')})`}
            active={maskEditMode === 'drawingEllipse'}
            onClick={() => startDrawMode('drawingEllipse')}
          />
          <IconButton
            icon="edit"
            title={`Edit Path (${registry.getLabel('mask.edit')})`}
            active={maskEditMode === 'editing'}
            disabled={!activeMask}
            onClick={() => {
              if (!activeMask) return;
              setActiveMask(clipId, activeMask.id);
              setMaskEditMode('editing');
            }}
          />
        </div>
        <div className="mask-toolbar-group">
          <IconButton icon="rect" title="Add rectangle mask" onClick={createRectangle} />
          <IconButton icon="ellipse" title="Add ellipse mask" onClick={createEllipse} />
          {maskEditMode !== 'none' && (
            <IconButton icon="close" title="Exit mask mode" className="cancel" onClick={() => setMaskEditMode('none')} />
          )}
        </div>
      </div>

      {activeMask && (
        <div className="mask-active-card">
          <div className="mask-active-header">
            <div>
              <strong>{activeMask.name}</strong>
              <span>{activeMask.closed ? 'Closed path' : 'Open path'} / {activeMask.vertices.length} vertices / {selectedVertexIds.size} selected</span>
            </div>
            <div className="mask-active-actions">
              <IconButton
                icon="power"
                title={activeMask.enabled === false ? 'Enable render' : 'Disable render'}
                active={activeMask.enabled !== false}
                onClick={() => updateMask(clipId, activeMask.id, { enabled: activeMask.enabled === false })}
              />
              <IconButton
                icon={activeMask.visible ? 'eye' : 'eyeOff'}
                title="Toggle outline"
                active={activeMask.visible}
                onClick={() => updateMask(clipId, activeMask.id, { visible: !activeMask.visible })}
              />
              <IconButton
                icon="invert"
                title={`Invert (${registry.getLabel('mask.invert')})`}
                active={activeMask.inverted}
                onClick={() => updateMask(clipId, activeMask.id, { inverted: !activeMask.inverted })}
              />
              <IconButton
                icon="close"
                title={`Close Path (${registry.getLabel('mask.closePath')})`}
                disabled={activeMask.closed || activeMask.vertices.length < 3}
                onClick={() => closeMask(clipId, activeMask.id)}
              />
            </div>
          </div>

          {selectedVertices.length > 0 && (
            <div className="mask-vertex-tools">
              <span>{selectedVertices.length} selected</span>
              <div className="mask-mode-segmented compact" role="group" aria-label="Vertex handle mode">
                <button
                  type="button"
                  className={selectedHandleMode === 'none' ? 'active' : ''}
                  title="Corner vertex"
                  onClick={() => setSelectedHandles('none')}
                >
                  Corner
                </button>
                <button
                  type="button"
                  className={selectedHandleMode === 'mirrored' ? 'active' : ''}
                  title={`Linked bezier handles (${registry.getLabel('mask.toggleVertexHandles')})`}
                  onClick={() => setSelectedHandles('mirrored')}
                >
                  Linked
                </button>
                <button
                  type="button"
                  className={selectedHandleMode === 'split' ? 'active' : ''}
                  title="Split bezier handles"
                  onClick={() => setSelectedHandles('split')}
                >
                  Split
                </button>
              </div>
              <IconButton
                icon="pen"
                title={`Cycle handle mode (${registry.getLabel('mask.toggleVertexHandles')})`}
                onClick={() => cycleSelectedHandles()}
              />
            </div>
          )}

          <div className="mask-mode-segmented" role="group" aria-label="Mask mode">
            {MASK_MODES.map(mode => (
              <button
                key={mode.value}
                type="button"
                className={activeMask.mode === mode.value ? 'active' : ''}
                onClick={() => updateMask(clipId, activeMask.id, { mode: mode.value })}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="mask-property-groups">
            <div className="mask-property-group">
              <h5>Edge</h5>
              <div className="control-row">
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: `mask.${activeMask.id}.feather`,
                    label: `${activeMask.name} / Feather`,
                    currentValue: activeMask.feather,
                    min: 0,
                    max: 500,
                  }}
                >
                  Feather
                </MIDIParameterLabel>
                <DraggableNumber
                  value={activeMask.feather}
                  onChange={(v) => updateMask(clipId, activeMask.id, { feather: Math.max(0, v) })}
                  defaultValue={0}
                  min={0}
                  max={500}
                  sensitivity={1}
                  decimals={1}
                  suffix="px"
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>
              <div className="control-row">
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: `mask.${activeMask.id}.featherQuality`,
                    label: `${activeMask.name} / Quality`,
                    currentValue: activeMask.featherQuality ?? 50,
                    min: 1,
                    max: 100,
                  }}
                >
                  Quality
                </MIDIParameterLabel>
                <DraggableNumber
                  value={activeMask.featherQuality ?? 50}
                  onChange={(v) => updateMask(clipId, activeMask.id, { featherQuality: Math.min(100, Math.max(1, Math.round(v))) })}
                  defaultValue={50}
                  min={1}
                  max={100}
                  sensitivity={1}
                  decimals={0}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>
            </div>

            <div className="mask-property-group">
              <h5>Transform</h5>
              <div className="control-row">
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: `mask.${activeMask.id}.position.x`,
                    label: `${activeMask.name} / Position X`,
                    currentValue: activeMask.position.x,
                    min: -1,
                    max: 1,
                  }}
                >
                  X
                </MIDIParameterLabel>
                <DraggableNumber
                  value={activeMask.position.x}
                  onChange={(v) => updateMask(clipId, activeMask.id, { position: { ...activeMask.position, x: v } })}
                  defaultValue={0}
                  sensitivity={100}
                  decimals={3}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>
              <div className="control-row">
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: `mask.${activeMask.id}.position.y`,
                    label: `${activeMask.name} / Position Y`,
                    currentValue: activeMask.position.y,
                    min: -1,
                    max: 1,
                  }}
                >
                  Y
                </MIDIParameterLabel>
                <DraggableNumber
                  value={activeMask.position.y}
                  onChange={(v) => updateMask(clipId, activeMask.id, { position: { ...activeMask.position, y: v } })}
                  defaultValue={0}
                  sensitivity={100}
                  decimals={3}
                  onDragStart={handleBatchStart}
                  onDragEnd={handleBatchEnd}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {maskList.length === 0 ? (
        <div className="mask-empty">No masks</div>
      ) : (
        <div className="mask-list">
          {maskList.map((mask, index) => (
            <MaskItem
              key={mask.id}
              clipId={clipId}
              mask={mask}
              index={index}
              count={maskList.length}
              isActive={activeMask?.id === mask.id}
              onSelect={() => selectMask(mask.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
