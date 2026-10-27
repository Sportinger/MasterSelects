// Buttons for what the desktop piano roll does with keys (Delete, Ctrl+C/V/D, Ctrl+Z/Y), shown only
// when the piano roll is embedded in the phone editor, where there is no keyboard. Each button runs
// the same handler as its shortcut, so a phone edit is the same single undo step as on the desktop.

import type { CSSProperties } from 'react';

export interface PianoRollTouchActionsProps {
  selectionCount: number;
  canPaste: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const BUTTON_STYLE: CSSProperties = {
  minWidth: 40, height: 36, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.86)', fontSize: 12, fontWeight: 600, touchAction: 'manipulation',
};

function ActionButton({ label, action, disabled, reason, onClick }: {
  label: string; action: string; disabled?: boolean; reason?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="pr-touch-action"
      data-testid={`piano-roll-action-${action}`}
      disabled={disabled}
      title={disabled ? reason : label}
      onClick={onClick}
      onPointerUp={(event) => event.currentTarget.blur()}
      style={{ ...BUTTON_STYLE, opacity: disabled ? 0.45 : 1 }}
    >
      {label}
    </button>
  );
}

export function PianoRollTouchActions({
  selectionCount, canPaste, onDelete, onDuplicate, onCopy, onPaste, onUndo, onRedo,
}: PianoRollTouchActionsProps) {
  const noSelection = 'Select notes first (Select tool, then tap or frame them)';
  return (
    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }} role="toolbar" aria-label="Note actions">
      <ActionButton label="Delete" action="delete" disabled={selectionCount === 0} reason={noSelection} onClick={onDelete} />
      <ActionButton label="Duplicate" action="duplicate" disabled={selectionCount === 0} reason={noSelection} onClick={onDuplicate} />
      <ActionButton label="Copy" action="copy" disabled={selectionCount === 0} reason={noSelection} onClick={onCopy} />
      <ActionButton label="Paste" action="paste" disabled={!canPaste} reason="Copy notes first" onClick={onPaste} />
      <ActionButton label="Undo" action="undo" onClick={onUndo} />
      <ActionButton label="Redo" action="redo" onClick={onRedo} />
    </div>
  );
}
