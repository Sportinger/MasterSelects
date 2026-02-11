// OutputManager - main component for managing output targets
// Renders in a popup window, manages source routing for all output windows

import { useState } from 'react';
import { TargetList } from './TargetList';
import { TargetPreview } from './TargetPreview';

export function OutputManager() {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  return (
    <div className="om-container">
      <div className="om-header">
        <h2 className="om-title">Output Manager</h2>
      </div>
      <div className="om-body">
        <div className="om-main">
          <TargetPreview targetId={selectedTargetId} />
        </div>
        <div className="om-sidebar">
          <TargetList
            selectedTargetId={selectedTargetId}
            onSelect={setSelectedTargetId}
          />
        </div>
      </div>
    </div>
  );
}
