import { useEffect, useRef, useState } from 'react';
import { EditableDraggableNumber } from '../../../common/EditableDraggableNumber';
import { startBatch, endBatch } from '../../../../stores/historyStore';
import type { PreviewValueControl } from '../../../../services/nodePreview/previewTypes';

/** Keep the value under the pointer immediate. Computed previews may arrive
 * later; they must not pull an active drag back to an older sampled number. */
export function PreviewNumber({ entry, revision, nodeId, label, onChange }: {
  entry: PreviewValueControl; revision: string; nodeId: string; label: string;
  onChange: (value: number) => boolean;
}) {
  const [local, setLocal] = useState<number>();
  const dragging = useRef(false), batchOpened = useRef(false);
  useEffect(() => {
    if (!dragging.current || Object.is(local, entry.value)) setLocal(undefined);
  }, [entry.value, revision]); // The authoritative preview reconciles after a drag.
  useEffect(() => () => { if (batchOpened.current) endBatch(); }, []);
  const value = local ?? Number(entry.value);
  return <EditableDraggableNumber value={value} defaultValue={Number(entry.defaultValue)} min={entry.min} max={entry.max}
    decimals={entry.step && entry.step >= 1 && Number.isInteger(value) ? 0 : 3} ariaLabel={label}
    persistenceKey={`node-inline.${nodeId}.${entry.target.parameter}`}
    onDragStart={() => { dragging.current = true; batchOpened.current = startBatch('Change node value').opened; }}
    onDragEnd={() => { dragging.current = false; if (batchOpened.current) { batchOpened.current = false; endBatch(); } }}
    onChange={next => { setLocal(next); if (!onChange(next)) setLocal(undefined); }} />;
}
