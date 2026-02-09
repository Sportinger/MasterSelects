import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';

describe('markerSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore();
  });

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

  it('removeMarker: removes by ID', () => {
    const id1 = store.getState().addMarker(10);
    const id2 = store.getState().addMarker(20);
    store.getState().removeMarker(id1);
    const state = store.getState();
    expect(state.markers.length).toBe(1);
    expect(state.markers[0].id).toBe(id2);
  });

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

  it('clearMarkers: removes all markers', () => {
    store.getState().addMarker(10);
    store.getState().addMarker(20);
    store.getState().addMarker(30);
    store.getState().clearMarkers();
    expect(store.getState().markers.length).toBe(0);
  });
});
