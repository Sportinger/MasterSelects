// Blendshapes Tab - ARKit 52 blendshape sliders for Gaussian Avatar clips
import { useState, useCallback, useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { ARKIT_BLENDSHAPE_NAMES, BLENDSHAPE_GROUPS, EMOTION_PRESETS } from '../../../engine/gaussian/types';
import { DraggableNumber } from './shared';
import { startBatch, endBatch } from '../../../stores/historyStore';
import { MIDIParameterLabel } from './MIDIParameterLabel';

interface BlendshapesTabProps {
  clipId: string;
}

/** Format camelCase blendshape name for display: "browDownLeft" -> "Brow Down L" */
function formatBlendshapeName(name: string): string {
  // Split camelCase
  const words = name.replace(/([A-Z])/g, ' $1').trim();
  // Shorten Left/Right to L/R
  return words
    .replace(/\bLeft$/i, 'L')
    .replace(/\bRight$/i, 'R')
    .replace(/^./, c => c.toUpperCase());
}

export function BlendshapesTab({ clipId }: BlendshapesTabProps) {
  const { updateClip } = useTimelineStore.getState();
  const source = useTimelineStore(s => s.clips.find(c => c.id === clipId)?.source);
  const blendshapes = useMemo(() => source?.gaussianBlendshapes ?? {}, [source]);

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  }, []);

  const handleBlendshapeChange = useCallback((name: string, value: number) => {
    if (!source) return;
    const clamped = Math.max(0, Math.min(1, value));
    const newBlendshapes = { ...blendshapes, [name]: clamped };
    // Remove zero values to keep the object clean
    if (clamped === 0) delete newBlendshapes[name];
    updateClip(clipId, { source: { ...source, gaussianBlendshapes: newBlendshapes } });
  }, [clipId, source, blendshapes, updateClip]);

  const handleBatchStart = useCallback(() => startBatch('Adjust blendshape'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);

  const applyPreset = useCallback((presetName: string) => {
    if (!source) return;
    const preset = EMOTION_PRESETS[presetName];
    if (!preset) return;
    // Start from all zeros, then apply preset values
    const newBlendshapes: Record<string, number> = {};
    for (const [name, value] of Object.entries(preset)) {
      if (value > 0) newBlendshapes[name] = value;
    }
    updateClip(clipId, { source: { ...source, gaussianBlendshapes: newBlendshapes } });
  }, [clipId, source, updateClip]);

  const resetAll = useCallback(() => {
    if (!source) return;
    updateClip(clipId, { source: { ...source, gaussianBlendshapes: {} } });
  }, [clipId, source, updateClip]);

  // Count active blendshapes (non-zero)
  const activeCount = Object.values(blendshapes).filter(v => v > 0).length;

  return (
    <div className="properties-tab-content blendshapes-tab">
      {/* Emotion Presets */}
      <div className="properties-section">
        <div className="section-header-row">
          <h4>Presets</h4>
          <button className="btn btn-sm" onClick={resetAll} title="Reset all blendshapes to zero">
            Reset All
          </button>
        </div>
        <div className="blendshape-presets">
          {Object.keys(EMOTION_PRESETS).map(name => (
            <button
              key={name}
              className="btn btn-sm"
              onClick={() => applyPreset(name)}
              title={`Apply ${name} preset`}
            >
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        {activeCount > 0 && (
          <div style={{ fontSize: '10px', color: '#888', marginTop: '4px' }}>
            {activeCount} / {ARKIT_BLENDSHAPE_NAMES.length} active
          </div>
        )}
      </div>

      {/* Blendshape Groups */}
      {Object.entries(BLENDSHAPE_GROUPS).map(([groupName, groupShapes]) => {
        const isCollapsed = collapsedGroups[groupName] ?? false;
        const groupActiveCount = groupShapes.filter(name => (blendshapes[name] ?? 0) > 0).length;

        return (
          <div key={groupName} className="properties-section">
            <div
              className="section-header-row blendshape-group-header"
              onClick={() => toggleGroup(groupName)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              <span className="blendshape-collapse-arrow">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
              <h4>{groupName}</h4>
              {groupActiveCount > 0 && (
                <span className="badge" style={{ marginLeft: '4px' }}>{groupActiveCount}</span>
              )}
            </div>

            {!isCollapsed && (
              <div className="blendshape-sliders">
                {groupShapes.map(name => {
                  const value = blendshapes[name] ?? 0;
                  return (
                    <div key={name} className="control-row blendshape-row">
                      <MIDIParameterLabel
                        as="label"
                        className="prop-label blendshape-label"
                        title={name}
                        target={{
                          clipId,
                          property: `blendshape.${name}`,
                          label: `${formatBlendshapeName(name)} Blendshape`,
                          currentValue: value,
                          min: 0,
                          max: 1,
                        }}
                      >
                        {formatBlendshapeName(name)}
                      </MIDIParameterLabel>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={value}
                        onChange={(e) => handleBlendshapeChange(name, parseFloat(e.target.value))}
                        className="blendshape-slider"
                      />
                      <DraggableNumber
                        value={value}
                        onChange={(v) => handleBlendshapeChange(name, v)}
                        defaultValue={0}
                        decimals={2}
                        min={0}
                        max={1}
                        sensitivity={100}
                        onDragStart={handleBatchStart}
                        onDragEnd={handleBatchEnd}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
