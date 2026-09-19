import { useMemo, useState } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { applyLookToClip, stackFromClipEffects } from '../../../effects/looks/applyLook';
import { getVisibleLooks, useLookStore } from '../../../effects/looks/lookStore';
import type { LookCategory } from '../../../effects/looks/types';
import { LookTile } from './LookTile';
import './LooksPanel.css';

const CATEGORIES: Array<{ id: LookCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'print', label: 'Print' },
  { id: 'digital', label: 'Digital' },
  { id: 'analog', label: 'Analog' },
  { id: 'motion', label: 'Motion' },
  { id: 'custom', label: 'Custom' },
];

export function LooksPanel() {
  const primarySelectedClipId = useTimelineStore((state) => state.primarySelectedClipId);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const clips = useTimelineStore((state) => state.clips);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const customLooks = useLookStore((state) => state.customLooks);
  const query = useLookStore((state) => state.query);
  const category = useLookStore((state) => state.category);
  const setQuery = useLookStore((state) => state.setQuery);
  const setCategory = useLookStore((state) => state.setCategory);
  const saveCustomLook = useLookStore((state) => state.saveCustomLook);
  const removeCustomLook = useLookStore((state) => state.removeCustomLook);
  const [newLookName, setNewLookName] = useState('');

  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : [...selectedClipIds][0] ?? null;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;
  const sourceFrameId = `${activeCompositionId ?? 'timeline'}:${Math.floor(playhead * 30)}`;
  const looks = useMemo(
    () => getVisibleLooks({ customLooks, query, category }),
    [category, customLooks, query],
  );

  const saveCurrent = () => {
    if (!selectedClip) return;
    const saved = saveCustomLook(newLookName, stackFromClipEffects(selectedClip.effects));
    if (saved) setNewLookName('');
  };

  return (
    <section className="looks-panel">
      <header className="looks-panel-tools">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search looks" aria-label="Search looks" />
        <select value={category} onChange={(event) => setCategory(event.target.value as LookCategory | 'all')} aria-label="Look category">
          {CATEGORIES.map((entry) => <option value={entry.id} key={entry.id}>{entry.label}</option>)}
        </select>
      </header>
      <div className="looks-save-row">
        <input value={newLookName} onChange={(event) => setNewLookName(event.target.value)} placeholder="Name current stack" />
        <button type="button" disabled={!selectedClip || !newLookName.trim() || selectedClip.effects.length === 0} onClick={saveCurrent}>Save</button>
      </div>
      {!selectedClip && <p className="looks-panel-hint">Select a visual clip to apply or save a look.</p>}
      <div className="looks-grid">
        {looks.map((look) => (
          <LookTile
            key={look.id}
            look={look}
            sourceFrameId={sourceFrameId}
            onApply={() => { if (selectedClipId) applyLookToClip(look, selectedClipId); }}
            onDelete={look.builtIn ? undefined : () => removeCustomLook(look.id)}
          />
        ))}
      </div>
    </section>
  );
}
