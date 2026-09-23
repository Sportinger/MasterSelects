import { useState } from 'react';
import './ExportRunActions.css';

interface Props {
  onCancel: () => void;
  onFinishEarly?: () => void;
  canFinishEarly: boolean;
}

export function ExportRunActions({ onCancel, onFinishEarly, canFinishEarly }: Props) {
  const [finishing, setFinishing] = useState(false);
  return (
    <div className="export-run-actions">
      <button type="button" className="export-run-cancel" onClick={onCancel}>
        Cancel
      </button>
      {onFinishEarly && (
        <button type="button" className="export-run-finish"
          disabled={!canFinishEarly || finishing}
          title="Finish the current frame and save the exported portion of the file"
          onClick={() => { setFinishing(true); onFinishEarly(); }}>
          {finishing ? 'Finishing file…' : 'Finish File Early'}
        </button>
      )}
    </div>
  );
}
