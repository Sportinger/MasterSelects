import { useState } from 'react';
import { CONTROL_OPERATORS } from '../../../../services/parameterSources/controlOperators';
import { addControlNode } from '../../../../services/parameterSources/parameterSourceActions';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import type { NodeGraphLayout } from '../../../../types/nodeGraph';

export function ControlNodeMenu({ clipId, layout, disabled, onAdded }: { clipId: string; layout?: NodeGraphLayout; disabled?: boolean; onAdded: (id: string) => void }) {
  const [message, setMessage] = useState('');
  return <div title={message || 'Add a procedural parameter source'}>
    <InspectorSelect ariaLabel="Add parameter source" disabled={disabled} value=""
      options={[{ value: '', label: '+ Control' }, ...CONTROL_OPERATORS.map(operator => ({ value: operator.id, label: operator.label }))]}
      onChange={operator => {
        if (!operator) return;
        try { onAdded(addControlNode(clipId, operator, layout)); setMessage(''); }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
      }} />
    {message && <span role="alert">{message}</span>}
  </div>;
}
