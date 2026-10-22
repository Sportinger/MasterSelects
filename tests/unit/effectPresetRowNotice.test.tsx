// The Preset row's note describes the effect as the preset left it: once the effect changes (Undo, a
// slider, a graph edit) the note and its Update node setup button go away instead of staying stale.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EffectPresetRow } from '../../src/components/panels/properties/EffectPresetRow';
import { migratePersistedEffectOperatorGraph } from '../../src/services/operators/effectGraphOwner';
import { useTimelineStore } from '../../src/stores/timeline';
import { getHistoryStateView, initHistoryStoreRefs, setHistoryCallbacks } from '../../src/stores/historyStore';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const SAVED: Record<string, { saved: Effect }> = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'glyph-graphs-saved-3.2.7.json'), 'utf8'));

beforeEach(() => {
  setHistoryCallbacks({ flushPendingCapture: () => undefined, suppressCaptures: () => undefined });
  initHistoryStoreRefs({ timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: () => ({ files: [], compositions: [], folders: [], selectedIds: [], expandedFolderIds: [], textItems: [], solidItems: [], mathSceneItems: [], motionShapeItems: [], signalAssets: [], signalArtifacts: [], signalGraphs: [], signalOperators: [] }), setState: () => undefined },
    dock: { getState: () => ({ layout: null }), setState: () => undefined } });
  getHistoryStateView().clearHistory();
  const clip = createMockClip({ id: 'preset-clip', effects: [migratePersistedEffectOperatorGraph(structuredClone(SAVED.ascii.saved))] });
  useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })], clipKeyframes: new Map(), isExporting: false });
});
afterEach(() => {
  cleanup();
  getHistoryStateView().clearHistory();
  useTimelineStore.setState({ clips: [], tracks: [], clipKeyframes: new Map(), isExporting: false });
});

function Card() {
  const effect = useTimelineStore(state => state.clips[0]?.effects[0]);
  return effect ? <div className="effects-tab"><EffectPresetRow clipId="preset-clip" effect={effect} /></div> : null;
}
const pick = (name: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Effect preset' }));
  fireEvent.click(screen.getByRole('option', { name }));
};

describe('Preset row note', () => {
  it('names the missing controls, offers Update node setup with what it replaces, and drops the note after Undo', () => {
    render(<Card />);
    pick('Green Terminal');
    const note = screen.getByRole('status');
    expect(note.textContent).toContain("Background and Black Level are not in this effect's saved node setup.");
    expect(note.textContent).toContain('It replaces any changes made in the Nodes tab; Undo brings them back.');
    fireEvent.click(screen.getByRole('button', { name: 'Update node setup' }));
    expect(screen.getByRole('status').textContent).toBe('Green Terminal: the node setup is updated (Undo brings back the old one).');
    act(() => { getHistoryStateView().undo(); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update node setup' })).toBeNull();
  });

  it('drops a "missing controls" note and its button once a value changes', () => {
    render(<Card />);
    pick('Green Terminal');
    expect(screen.getByRole('button', { name: 'Update node setup' })).toBeTruthy();
    act(() => {
      useTimelineStore.setState(state => ({ clips: state.clips.map(clip => ({ ...clip,
        effects: clip.effects.map(effect => ({ ...effect, params: { ...effect.params, opacity: 0.5 } })) })) }));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
