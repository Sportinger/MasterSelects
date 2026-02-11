import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('markerSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

  // ─── addMarker ──────────────────────────────────────────────────────

  it('addMarker: creates marker with correct defaults', () => {
    const id = store.getState().addMarker(10);
    const state = store.getState();
    expect(state.markers.length).toBe(1);
    expect(state.markers[0].id).toBe(id);
    expect(state.markers[0].time).toBe(10);
    expect(state.markers[0].label).toBe('');
    expect(state.markers[0].color).toBe('#2997E5');
  });

  it('addMarker: accepts label and color', () => {
    store.getState().addMarker(5, 'Scene 1', '#ff0000');
    const marker = store.getState().markers[0];
    expect(marker.label).toBe('Scene 1');
    expect(marker.color).toBe('#ff0000');
  });

  it('addMarker: clamps time to [0, duration]', () => {
    store.getState().addMarker(-5);
    expect(store.getState().markers[0].time).toBe(0);

    store.getState().addMarker(999);
    expect(store.getState().markers[1].time).toBe(60); // default duration
  });

  it('addMarker: markers stay sorted by time', () => {
    store.getState().addMarker(30);
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    const times = store.getState().markers.map(m => m.time);
    expect(times).toEqual([10, 20, 30]);
  });

  it('addMarker: returns a string ID with marker prefix', () => {
    const id = store.getState().addMarker(5);
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^marker-/);
  });

  it('addMarker: each marker gets a unique ID', () => {
    const id1 = store.getState().addMarker(5);
    const id2 = store.getState().addMarker(10);
    const id3 = store.getState().addMarker(15);
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('addMarker: at time 0 (lower boundary)', () => {
    store.getState().addMarker(0);
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('addMarker: at exact duration (upper boundary)', () => {
    store.getState().addMarker(60); // default duration is 60
    expect(store.getState().markers[0].time).toBe(60);
  });

  it('addMarker: multiple markers at the same time', () => {
    store.getState().addMarker(10, 'A');
    store.getState().addMarker(10, 'B');
    store.getState().addMarker(10, 'C');
    const markers = store.getState().markers;
    expect(markers.length).toBe(3);
    expect(markers.every(m => m.time === 10)).toBe(true);
    const labels = markers.map(m => m.label);
    expect(labels).toContain('A');
    expect(labels).toContain('B');
    expect(labels).toContain('C');
  });

  it('addMarker: with explicit empty string label uses empty string', () => {
    store.getState().addMarker(5, '');
    expect(store.getState().markers[0].label).toBe('');
  });

  it('addMarker: respects custom duration via store overrides', () => {
    const customStore = createTestTimelineStore({ duration: 120 } as any);
    customStore.getState().addMarker(100);
    expect(customStore.getState().markers[0].time).toBe(100);

    customStore.getState().addMarker(200);
    expect(customStore.getState().markers[1].time).toBe(120); // clamped to 120
  });

  it('addMarker: large negative time clamps to 0', () => {
    store.getState().addMarker(-99999);
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('addMarker: fractional time is preserved', () => {
    store.getState().addMarker(5.5);
    expect(store.getState().markers[0].time).toBe(5.5);
  });

  it('addMarker: many markers remain sorted', () => {
    const times = [50, 10, 40, 20, 30, 5, 55, 15, 45, 25];
    times.forEach(t => store.getState().addMarker(t));
    const sorted = store.getState().markers.map(m => m.time);
    expect(sorted).toEqual([5, 10, 15, 20, 25, 30, 40, 45, 50, 55]);
  });

  // ─── removeMarker ──────────────────────────────────────────────────

  it('removeMarker: removes by ID', () => {
    const id1 = store.getState().addMarker(10);
    const id2 = store.getState().addMarker(20);
    store.getState().removeMarker(id1);
    const state = store.getState();
    expect(state.markers.length).toBe(1);
    expect(state.markers[0].id).toBe(id2);
  });

  it('removeMarker: non-existent ID is a no-op', () => {
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().removeMarker('non-existent-id');
    expect(store.getState().markers.length).toBe(2);
  });

  it('removeMarker: removing last marker results in empty array', () => {
    const id = store.getState().addMarker(10);
    store.getState().removeMarker(id);
    expect(store.getState().markers).toEqual([]);
  });

  it('removeMarker: preserves sort order of remaining markers', () => {
    store.getState().addMarker(10);
    const id2 = store.getState().addMarker(20);
    store.getState().addMarker(30);
    store.getState().removeMarker(id2);
    const times = store.getState().markers.map(m => m.time);
    expect(times).toEqual([10, 30]);
  });

  it('removeMarker: can remove markers one by one until empty', () => {
    const id1 = store.getState().addMarker(10);
    const id2 = store.getState().addMarker(20);
    const id3 = store.getState().addMarker(30);
    store.getState().removeMarker(id2);
    expect(store.getState().markers.length).toBe(2);
    store.getState().removeMarker(id1);
    expect(store.getState().markers.length).toBe(1);
    store.getState().removeMarker(id3);
    expect(store.getState().markers.length).toBe(0);
  });

  it('removeMarker: same ID twice is a no-op on second call', () => {
    const id = store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().removeMarker(id);
    expect(store.getState().markers.length).toBe(1);
    store.getState().removeMarker(id);
    expect(store.getState().markers.length).toBe(1);
  });

  // ─── updateMarker ──────────────────────────────────────────────────

  it('updateMarker: updates label and color', () => {
    const id = store.getState().addMarker(10);
    store.getState().updateMarker(id, { label: 'Updated', color: '#00ff00' });
    const marker = store.getState().markers[0];
    expect(marker.label).toBe('Updated');
    expect(marker.color).toBe('#00ff00');
    expect(marker.time).toBe(10); // unchanged
  });

  it('updateMarker: clamps time update to [0, duration]', () => {
    const id = store.getState().addMarker(10);
    store.getState().updateMarker(id, { time: 999 });
    expect(store.getState().markers[0].time).toBe(60);
  });

  it('updateMarker: updates only label, preserves color and time', () => {
    const id = store.getState().addMarker(10, 'Original', '#ff0000');
    store.getState().updateMarker(id, { label: 'New Label' });
    const marker = store.getState().markers[0];
    expect(marker.label).toBe('New Label');
    expect(marker.color).toBe('#ff0000');
    expect(marker.time).toBe(10);
  });

  it('updateMarker: updates only color, preserves label and time', () => {
    const id = store.getState().addMarker(10, 'Keep Me', '#ff0000');
    store.getState().updateMarker(id, { color: '#00ff00' });
    const marker = store.getState().markers[0];
    expect(marker.label).toBe('Keep Me');
    expect(marker.color).toBe('#00ff00');
    expect(marker.time).toBe(10);
  });

  it('updateMarker: updates only time, preserves label and color', () => {
    const id = store.getState().addMarker(10, 'Stay', '#abcdef');
    store.getState().updateMarker(id, { time: 30 });
    const marker = store.getState().markers[0];
    expect(marker.time).toBe(30);
    expect(marker.label).toBe('Stay');
    expect(marker.color).toBe('#abcdef');
  });

  it('updateMarker: time update re-sorts markers', () => {
    const id1 = store.getState().addMarker(10, 'First');
    store.getState().addMarker(20, 'Second');
    store.getState().addMarker(30, 'Third');
    // Move first marker to after the third
    store.getState().updateMarker(id1, { time: 35 });
    const labels = store.getState().markers.map(m => m.label);
    expect(labels).toEqual(['Second', 'Third', 'First']);
  });

  it('updateMarker: negative time clamps to 0', () => {
    const id = store.getState().addMarker(10);
    store.getState().updateMarker(id, { time: -50 });
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('updateMarker: time at exact boundary (0) works', () => {
    const id = store.getState().addMarker(10);
    store.getState().updateMarker(id, { time: 0 });
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('updateMarker: time at exact boundary (duration) works', () => {
    const id = store.getState().addMarker(10);
    store.getState().updateMarker(id, { time: 60 });
    expect(store.getState().markers[0].time).toBe(60);
  });

  it('updateMarker: non-existent marker ID is a no-op', () => {
    store.getState().addMarker(10, 'Original');
    store.getState().updateMarker('non-existent', { label: 'Hacked' });
    expect(store.getState().markers[0].label).toBe('Original');
    expect(store.getState().markers.length).toBe(1);
  });

  it('updateMarker: empty updates object is a no-op', () => {
    const id = store.getState().addMarker(10, 'Keep', '#ff0000');
    store.getState().updateMarker(id, {});
    const marker = store.getState().markers[0];
    expect(marker.time).toBe(10);
    expect(marker.label).toBe('Keep');
    expect(marker.color).toBe('#ff0000');
  });

  it('updateMarker: all fields at once', () => {
    const id = store.getState().addMarker(10, 'Old', '#ff0000');
    store.getState().updateMarker(id, { time: 20, label: 'New', color: '#00ff00' });
    const marker = store.getState().markers[0];
    expect(marker.time).toBe(20);
    expect(marker.label).toBe('New');
    expect(marker.color).toBe('#00ff00');
  });

  it('updateMarker: does not affect other markers', () => {
    const id1 = store.getState().addMarker(10, 'A', '#111111');
    const id2 = store.getState().addMarker(20, 'B', '#222222');
    store.getState().updateMarker(id1, { label: 'A-updated' });
    const markers = store.getState().markers;
    const m2 = markers.find(m => m.id === id2)!;
    expect(m2.label).toBe('B');
    expect(m2.color).toBe('#222222');
    expect(m2.time).toBe(20);
  });

  // ─── moveMarker ────────────────────────────────────────────────────

  it('moveMarker: changes time and re-sorts', () => {
    const id1 = store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().moveMarker(id1, 25);
    const times = store.getState().markers.map(m => m.time);
    expect(times).toEqual([20, 25]);
  });

  it('moveMarker: clamps to [0, duration]', () => {
    const id = store.getState().addMarker(10);
    store.getState().moveMarker(id, -10);
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('moveMarker: clamps to upper bound (duration)', () => {
    const id = store.getState().addMarker(10);
    store.getState().moveMarker(id, 999);
    expect(store.getState().markers[0].time).toBe(60);
  });

  it('moveMarker: to exact 0 boundary', () => {
    const id = store.getState().addMarker(30);
    store.getState().moveMarker(id, 0);
    expect(store.getState().markers[0].time).toBe(0);
  });

  it('moveMarker: to exact duration boundary', () => {
    const id = store.getState().addMarker(10);
    store.getState().moveMarker(id, 60);
    expect(store.getState().markers[0].time).toBe(60);
  });

  it('moveMarker: preserves label and color', () => {
    const id = store.getState().addMarker(10, 'Scene', '#abcdef');
    store.getState().moveMarker(id, 40);
    const marker = store.getState().markers[0];
    expect(marker.label).toBe('Scene');
    expect(marker.color).toBe('#abcdef');
    expect(marker.time).toBe(40);
  });

  it('moveMarker: to same position is effectively a no-op', () => {
    const id = store.getState().addMarker(10);
    store.getState().moveMarker(id, 10);
    expect(store.getState().markers[0].time).toBe(10);
  });

  it('moveMarker: non-existent ID is a no-op', () => {
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().moveMarker('non-existent', 30);
    const times = store.getState().markers.map(m => m.time);
    expect(times).toEqual([10, 20]);
  });

  it('moveMarker: fractional time is preserved', () => {
    const id = store.getState().addMarker(10);
    store.getState().moveMarker(id, 15.75);
    expect(store.getState().markers[0].time).toBe(15.75);
  });

  it('moveMarker: does not affect other markers', () => {
    const id1 = store.getState().addMarker(10, 'A');
    const id2 = store.getState().addMarker(20, 'B');
    store.getState().moveMarker(id1, 25);
    const m2 = store.getState().markers.find(m => m.id === id2)!;
    expect(m2.time).toBe(20);
    expect(m2.label).toBe('B');
  });

  // ─── clearMarkers ──────────────────────────────────────────────────

  it('clearMarkers: removes all markers', () => {
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().addMarker(30);
    store.getState().clearMarkers();
    expect(store.getState().markers.length).toBe(0);
  });

  it('clearMarkers: on already empty is a no-op', () => {
    expect(store.getState().markers.length).toBe(0);
    store.getState().clearMarkers();
    expect(store.getState().markers.length).toBe(0);
  });

  it('clearMarkers: allows adding new markers afterwards', () => {
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().clearMarkers();
    expect(store.getState().markers.length).toBe(0);

    store.getState().addMarker(5, 'Fresh');
    expect(store.getState().markers.length).toBe(1);
    expect(store.getState().markers[0].label).toBe('Fresh');
  });

  // ─── Integration / multi-operation sequences ───────────────────────

  it('integration: add, update, move, remove sequence', () => {
    // Add three markers
    const id1 = store.getState().addMarker(10, 'A', '#111111');
    const id2 = store.getState().addMarker(20, 'B', '#222222');
    const id3 = store.getState().addMarker(30, 'C', '#333333');
    expect(store.getState().markers.length).toBe(3);

    // Update the label of the second
    store.getState().updateMarker(id2, { label: 'B-updated' });
    expect(store.getState().markers.find(m => m.id === id2)!.label).toBe('B-updated');

    // Move the first marker past the third
    store.getState().moveMarker(id1, 35);
    const times1 = store.getState().markers.map(m => m.time);
    expect(times1).toEqual([20, 30, 35]);

    // Remove the middle marker
    store.getState().removeMarker(id3);
    expect(store.getState().markers.length).toBe(2);
    const times2 = store.getState().markers.map(m => m.time);
    expect(times2).toEqual([20, 35]);

    // Clear everything
    store.getState().clearMarkers();
    expect(store.getState().markers.length).toBe(0);
  });

  it('integration: add markers with custom duration store', () => {
    const shortStore = createTestTimelineStore({ duration: 10 } as any);
    shortStore.getState().addMarker(5, 'Inside');
    shortStore.getState().addMarker(15, 'Over'); // should clamp to 10
    shortStore.getState().addMarker(-3, 'Under'); // should clamp to 0
    const times = shortStore.getState().markers.map(m => m.time);
    expect(times).toEqual([0, 5, 10]);
  });

  it('integration: move and update interleaved maintain consistency', () => {
    const id1 = store.getState().addMarker(10, 'One');
    const id2 = store.getState().addMarker(20, 'Two');
    const id3 = store.getState().addMarker(30, 'Three');

    // Move first to middle
    store.getState().moveMarker(id1, 25);
    // Update second's time to end
    store.getState().updateMarker(id2, { time: 50 });

    const markers = store.getState().markers;
    expect(markers.map(m => m.time)).toEqual([25, 30, 50]);
    // Check IDs are still correctly associated
    expect(markers[0].id).toBe(id1);
    expect(markers[1].id).toBe(id3);
    expect(markers[2].id).toBe(id2);
  });

  // ─── Initial state ─────────────────────────────────────────────────

  it('initial state: markers array starts empty', () => {
    expect(store.getState().markers).toEqual([]);
    expect(store.getState().markers.length).toBe(0);
  });
});
