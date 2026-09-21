import { useState } from 'react';
import type { Effect } from '../../../../types/effects';
import type { NodeGraphLayout } from '../../../../types/nodeGraph';
import { addableEffectOperators } from '../../../../services/operators/effectGraphOwner';
import { createEffectGraphActions } from '../../../../services/operators/effectGraphEditing';
import { effectGraphId } from '../../../../services/nodeGraph/effectGraphProjection';
import { handleSubmenuHover, handleSubmenuLeave } from '../../media/submenuPosition';
import { startBatch, endBatch } from '../../../../stores/historyStore';

export function ReusableNodeMenu({ clipId, effect, position, onAdded }: {
  clipId: string; effect?: Effect; position: NodeGraphLayout; onAdded: (id: string) => void;
}) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState('');
  const operators = effect ? addableEffectOperators(effect.type).filter(operator => operator.composition) : [];
  return <div className={`node-workspace-context-submenu${open ? ' is-open' : ''}`}
    onMouseEnter={event => { handleSubmenuHover(event); setOpen(true); }}
    onMouseLeave={event => { handleSubmenuLeave(event); setOpen(false); }}
    onClick={event => {
      if (event.target !== event.currentTarget.firstElementChild) return;
      handleSubmenuHover(event); setOpen(true);
    }}
    onBlur={event => {
      // Pointer-focus cleanup can blur the trigger before the item's click arrives.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={event => { if (event.key === 'Escape') {
      event.stopPropagation(); setOpen(false);
      (event.currentTarget.firstElementChild as HTMLButtonElement).focus({ preventScroll: true });
    } }}>
    <button type="button" disabled={!operators.length} aria-haspopup="menu" aria-expanded={open}
      title={operators.length ? `Add a building block to ${effect!.name}` : 'Select an image effect or one of its nodes first'}
      >Reusable Nodes</button>
    {!!operators.length && <div className="node-workspace-context-submenu-list context-submenu" style={{ display: open ? 'flex' : 'none' }}>
      <div className="node-workspace-context-submenu-group"><span>Into {effect!.name}</span></div>
      {['Coordinates', 'Fisheye'].map(category => <div key={category} className="node-workspace-context-submenu-group">
        <span>{category}</span>
        {operators.filter(operator => operator.id.startsWith('fisheye.') === (category === 'Fisheye')).map(operator =>
          <button key={operator.id} type="button" title={operator.description} onClick={() => {
            const batch = startBatch('Add reusable node');
            try {
              const id = createEffectGraphActions(clipId, effect!.id).addNode(operator.id, position);
              onAdded(`${effectGraphId(clipId, effect!.id)}/${id}`);
            } catch (error) { setMessage(String(error)); }
            finally { if (batch.opened) endBatch(); }
          }}>{operator.label}</button>)}
      </div>)}
      {message && <p role="alert">{message}</p>}
    </div>}
  </div>;
}
