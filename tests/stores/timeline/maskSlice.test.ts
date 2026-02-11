import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, resetIdCounter } from '../../helpers/mockData';

describe('maskSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;
  const clip = createMockClip({ id: 'clip-1', trackId: 'video-1', startTime: 0, duration: 10 });

  beforeEach(() => {
    resetIdCounter();
    store = createTestTimelineStore({ clips: [clip] } as any);
  });

  // ─── addMask ──────────────────────────────────────────────────────

  it('addMask: adds a mask to a clip with default properties', () => {
    const maskId = store.getState().addMask('clip-1');
    const masks = store.getState().clips.find(c => c.id === 'clip-1')?.masks;
    expect(masks).toBeDefined();
    expect(masks!.length).toBe(1);
    const mask = masks![0];
    expect(mask.id).toBe(maskId);
    expect(mask.name).toBe('Mask 1');
    expect(mask.vertices).toEqual([]);
    expect(mask.closed).toBe(false);
    expect(mask.opacity).toBe(1);
    expect(mask.feather).toBe(0);
    expect(mask.inverted).toBe(false);
    expect(mask.mode).toBe('add');
    expect(mask.visible).toBe(true);
  });

  it('addMask: uses provided partial mask data', () => {
    store.getState().addMask('clip-1', {
      name: 'Custom Mask',
      opacity: 0.5,
      feather: 10,
      inverted: true,
      mode: 'subtract',
    });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.name).toBe('Custom Mask');
    expect(mask.opacity).toBe(0.5);
    expect(mask.feather).toBe(10);
    expect(mask.inverted).toBe(true);
    expect(mask.mode).toBe('subtract');
  });

  it('addMask: increments mask name based on existing count', () => {
    store.getState().addMask('clip-1');
    store.getState().addMask('clip-1');
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks[0].name).toBe('Mask 1');
    expect(masks[1].name).toBe('Mask 2');
  });

  it('addMask: sets all default properties including expanded, position, featherQuality', () => {
    store.getState().addMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.expanded).toBe(true);
    expect(mask.position).toEqual({ x: 0, y: 0 });
    expect(mask.featherQuality).toBe(50);
  });

  it('addMask: uses provided expanded, position, visible, and featherQuality', () => {
    store.getState().addMask('clip-1', {
      expanded: false,
      position: { x: 0.25, y: 0.75 },
      visible: false,
      featherQuality: 80,
    });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.expanded).toBe(false);
    expect(mask.position).toEqual({ x: 0.25, y: 0.75 });
    expect(mask.visible).toBe(false);
    expect(mask.featherQuality).toBe(80);
  });

  it('addMask: uses provided vertices and closed state', () => {
    const vertices = [
      { id: 'v1', x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
      { id: 'v2', x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
    ];
    store.getState().addMask('clip-1', { vertices, closed: true });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.vertices.length).toBe(2);
    expect(mask.vertices[0].x).toBe(0);
    expect(mask.vertices[1].x).toBe(1);
    expect(mask.closed).toBe(true);
  });

  it('addMask: returns a unique mask id', () => {
    const id1 = store.getState().addMask('clip-1');
    const id2 = store.getState().addMask('clip-1');
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('addMask: name increments correctly after removing a mask', () => {
    store.getState().addMask('clip-1'); // Mask 1
    const maskId2 = store.getState().addMask('clip-1'); // Mask 2
    store.getState().removeMask('clip-1', maskId2);
    // After removal there is 1 mask, so next name should be "Mask 2" (count=1+1=2)
    store.getState().addMask('clip-1');
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(2);
    expect(masks[1].name).toBe('Mask 2');
  });

  it('addMask: does not affect other clips', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 10, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    store.getState().addMask('clip-1');
    const clip2Masks = store.getState().clips.find(c => c.id === 'clip-2')?.masks;
    // clip-2 should remain unaffected (no masks array or empty)
    expect(clip2Masks?.length ?? 0).toBe(0);
  });

  // ─── removeMask ───────────────────────────────────────────────────

  it('removeMask: removes the specified mask from a clip', () => {
    const maskId = store.getState().addMask('clip-1');
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks!.length).toBe(1);
    store.getState().removeMask('clip-1', maskId);
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks!.length).toBe(0);
  });

  it('removeMask: clears activeMaskId when the active mask is removed', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId);
    expect(store.getState().activeMaskId).toBe(maskId);
    store.getState().removeMask('clip-1', maskId);
    expect(store.getState().activeMaskId).toBeNull();
  });

  it('removeMask: does not clear activeMaskId when a different mask is removed', () => {
    const maskId1 = store.getState().addMask('clip-1');
    const maskId2 = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId1);
    store.getState().removeMask('clip-1', maskId2);
    expect(store.getState().activeMaskId).toBe(maskId1);
  });

  it('removeMask: removes only the targeted mask, leaving others intact', () => {
    const maskId1 = store.getState().addMask('clip-1', { name: 'Keep' });
    const maskId2 = store.getState().addMask('clip-1', { name: 'Remove' });
    const maskId3 = store.getState().addMask('clip-1', { name: 'Also Keep' });
    store.getState().removeMask('clip-1', maskId2);
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(2);
    expect(masks[0].id).toBe(maskId1);
    expect(masks[1].id).toBe(maskId3);
  });

  it('removeMask: does not throw for nonexistent maskId', () => {
    store.getState().addMask('clip-1');
    expect(() => store.getState().removeMask('clip-1', 'nonexistent-mask')).not.toThrow();
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks!.length).toBe(1);
  });

  // ─── updateMask ───────────────────────────────────────────────────

  it('updateMask: updates opacity, feather, and inversion', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, {
      opacity: 0.3,
      feather: 15,
      inverted: true,
    });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.opacity).toBe(0.3);
    expect(mask.feather).toBe(15);
    expect(mask.inverted).toBe(true);
  });

  it('updateMask: changes mask mode', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, { mode: 'intersect' });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.mode).toBe('intersect');
  });

  it('updateMask: changes name', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, { name: 'Renamed Mask' });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.name).toBe('Renamed Mask');
  });

  it('updateMask: changes visible and expanded', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, { visible: false, expanded: false });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.visible).toBe(false);
    expect(mask.expanded).toBe(false);
  });

  it('updateMask: updates position offset', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, { position: { x: 0.5, y: 0.3 } });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.position).toEqual({ x: 0.5, y: 0.3 });
  });

  it('updateMask: updates featherQuality', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().updateMask('clip-1', maskId, { featherQuality: 90 });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.featherQuality).toBe(90);
  });

  it('updateMask: only updates the targeted mask, not others', () => {
    const maskId1 = store.getState().addMask('clip-1', { opacity: 1 });
    const maskId2 = store.getState().addMask('clip-1', { opacity: 1 });
    store.getState().updateMask('clip-1', maskId2, { opacity: 0.5 });
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.find(m => m.id === maskId1)!.opacity).toBe(1);
    expect(masks.find(m => m.id === maskId2)!.opacity).toBe(0.5);
  });

  it('updateMask: does not throw for nonexistent maskId', () => {
    store.getState().addMask('clip-1');
    expect(() => store.getState().updateMask('clip-1', 'nonexistent', { opacity: 0 })).not.toThrow();
  });

  // ─── Multiple masks per clip ──────────────────────────────────────

  it('supports multiple masks on the same clip', () => {
    store.getState().addMask('clip-1', { name: 'A', mode: 'add' });
    store.getState().addMask('clip-1', { name: 'B', mode: 'subtract' });
    store.getState().addMask('clip-1', { name: 'C', mode: 'intersect' });
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(3);
    expect(masks.map(m => m.mode)).toEqual(['add', 'subtract', 'intersect']);
  });

  // ─── Multiple clips with masks ─────────────────────────────────────

  it('supports masks on different clips independently', () => {
    const clip2 = createMockClip({ id: 'clip-2', trackId: 'video-1', startTime: 10, duration: 5 });
    store = createTestTimelineStore({ clips: [clip, clip2] } as any);
    store.getState().addMask('clip-1', { name: 'Mask on clip-1' });
    store.getState().addMask('clip-2', { name: 'Mask on clip-2' });
    expect(store.getState().getClipMasks('clip-1').length).toBe(1);
    expect(store.getState().getClipMasks('clip-2').length).toBe(1);
    expect(store.getState().getClipMasks('clip-1')[0].name).toBe('Mask on clip-1');
    expect(store.getState().getClipMasks('clip-2')[0].name).toBe('Mask on clip-2');
  });

  // ─── reorderMasks ─────────────────────────────────────────────────

  it('reorderMasks: moves mask from one index to another', () => {
    store.getState().addMask('clip-1', { name: 'First' });
    store.getState().addMask('clip-1', { name: 'Second' });
    store.getState().addMask('clip-1', { name: 'Third' });
    store.getState().reorderMasks('clip-1', 0, 2);
    const names = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.map(m => m.name);
    expect(names).toEqual(['Second', 'Third', 'First']);
  });

  it('reorderMasks: moves last mask to front', () => {
    store.getState().addMask('clip-1', { name: 'A' });
    store.getState().addMask('clip-1', { name: 'B' });
    store.getState().addMask('clip-1', { name: 'C' });
    store.getState().reorderMasks('clip-1', 2, 0);
    const names = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.map(m => m.name);
    expect(names).toEqual(['C', 'A', 'B']);
  });

  it('reorderMasks: no-op for nonexistent clip', () => {
    store.getState().addMask('clip-1', { name: 'Only' });
    expect(() => store.getState().reorderMasks('no-such-clip', 0, 1)).not.toThrow();
    // Original clip masks unchanged
    expect(store.getState().getClipMasks('clip-1')[0].name).toBe('Only');
  });

  it('reorderMasks: no-op when clip has no masks', () => {
    // clip-1 has no masks initially
    expect(() => store.getState().reorderMasks('clip-1', 0, 1)).not.toThrow();
  });

  // ─── getClipMasks ─────────────────────────────────────────────────

  it('getClipMasks: returns masks for a clip, empty array for unknown clip', () => {
    store.getState().addMask('clip-1');
    expect(store.getState().getClipMasks('clip-1').length).toBe(1);
    expect(store.getState().getClipMasks('nonexistent')).toEqual([]);
  });

  it('getClipMasks: returns all masks in order', () => {
    store.getState().addMask('clip-1', { name: 'First' });
    store.getState().addMask('clip-1', { name: 'Second' });
    store.getState().addMask('clip-1', { name: 'Third' });
    const masks = store.getState().getClipMasks('clip-1');
    expect(masks.map(m => m.name)).toEqual(['First', 'Second', 'Third']);
  });

  // ─── Vertex operations ────────────────────────────────────────────

  it('addVertex: appends a vertex to a mask', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.vertices.length).toBe(1);
    expect(mask.vertices[0].id).toBe(vertexId);
    expect(mask.vertices[0].x).toBe(0.5);
    expect(mask.vertices[0].y).toBe(0.5);
  });

  it('addVertex: inserts at specified index', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().addVertex('clip-1', maskId, { x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().addVertex('clip-1', maskId, { x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }, 1);
    const vertices = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices;
    expect(vertices.length).toBe(3);
    expect(vertices[0].x).toBe(0);
    expect(vertices[1].x).toBe(0.5);
    expect(vertices[2].x).toBe(1);
  });

  it('addVertex: inserts at index 0 (beginning)', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }, 0);
    const vertices = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices;
    expect(vertices.length).toBe(2);
    expect(vertices[0].x).toBe(0.1);
    expect(vertices[1].x).toBe(0.5);
  });

  it('addVertex: preserves bezier handle data', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, {
      x: 0.5, y: 0.5,
      handleIn: { x: -0.1, y: -0.2 },
      handleOut: { x: 0.3, y: 0.4 },
    });
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.id).toBe(vertexId);
    expect(vertex.handleIn).toEqual({ x: -0.1, y: -0.2 });
    expect(vertex.handleOut).toEqual({ x: 0.3, y: 0.4 });
  });

  it('addVertex: returns a unique vertex id', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    expect(v1).toBeTruthy();
    expect(v2).toBeTruthy();
    expect(v1).not.toBe(v2);
  });

  it('removeVertex: removes vertex and clears it from selection', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(vertexId);
    expect(store.getState().selectedVertexIds.has(vertexId)).toBe(true);
    store.getState().removeVertex('clip-1', maskId, vertexId);
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.vertices.length).toBe(0);
    expect(store.getState().selectedVertexIds.has(vertexId)).toBe(false);
  });

  it('removeVertex: keeps other vertices and their selection intact', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v3 = store.getState().addVertex('clip-1', maskId, { x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(v1);
    store.getState().selectVertex(v3, true);
    store.getState().removeVertex('clip-1', maskId, v2);
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.vertices.length).toBe(2);
    expect(mask.vertices[0].id).toBe(v1);
    expect(mask.vertices[1].id).toBe(v3);
    expect(store.getState().selectedVertexIds.has(v1)).toBe(true);
    expect(store.getState().selectedVertexIds.has(v3)).toBe(true);
  });

  it('removeVertex: does not throw when vertex is not selected', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    // Do not select the vertex
    expect(() => store.getState().removeVertex('clip-1', maskId, vertexId)).not.toThrow();
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices.length).toBe(0);
  });

  it('updateVertex: moves a vertex to new coordinates', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().updateVertex('clip-1', maskId, vertexId, { x: 0.9, y: 0.8 });
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.x).toBe(0.9);
    expect(vertex.y).toBe(0.8);
  });

  it('updateVertex: updates bezier handles', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().updateVertex('clip-1', maskId, vertexId, {
      handleIn: { x: -0.2, y: -0.3 },
      handleOut: { x: 0.2, y: 0.3 },
    });
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.handleIn).toEqual({ x: -0.2, y: -0.3 });
    expect(vertex.handleOut).toEqual({ x: 0.2, y: 0.3 });
    // Position should remain unchanged
    expect(vertex.x).toBe(0.5);
    expect(vertex.y).toBe(0.5);
  });

  it('updateVertex: partial update preserves other fields', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, {
      x: 0.1, y: 0.2,
      handleIn: { x: -0.1, y: -0.1 },
      handleOut: { x: 0.1, y: 0.1 },
    });
    // Only update x
    store.getState().updateVertex('clip-1', maskId, vertexId, { x: 0.8 });
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.x).toBe(0.8);
    expect(vertex.y).toBe(0.2); // preserved
    expect(vertex.handleIn).toEqual({ x: -0.1, y: -0.1 }); // preserved
    expect(vertex.handleOut).toEqual({ x: 0.1, y: 0.1 }); // preserved
  });

  it('updateVertex: only updates the targeted vertex', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().updateVertex('clip-1', maskId, v2, { x: 0.9 });
    const vertices = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices;
    expect(vertices[0].x).toBe(0.1); // v1 unchanged
    expect(vertices[1].x).toBe(0.9); // v2 updated
  });

  it('updateVertex: accepts skipCacheInvalidation parameter without error', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    expect(() => {
      store.getState().updateVertex('clip-1', maskId, vertexId, { x: 0.5 }, true);
    }).not.toThrow();
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.x).toBe(0.5);
  });

  // ─── Preset shapes ───────────────────────────────────────────────

  it('addRectangleMask: creates a closed mask with 4 vertices', () => {
    const maskId = store.getState().addRectangleMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.find(m => m.id === maskId)!;
    expect(mask.name).toBe('Rectangle Mask');
    expect(mask.closed).toBe(true);
    expect(mask.vertices.length).toBe(4);
    // Verify corners are at the expected 10% margin positions
    expect(mask.vertices[0].x).toBeCloseTo(0.1);
    expect(mask.vertices[0].y).toBeCloseTo(0.1);
    expect(mask.vertices[1].x).toBeCloseTo(0.9);
    expect(mask.vertices[1].y).toBeCloseTo(0.1);
    expect(mask.vertices[2].x).toBeCloseTo(0.9);
    expect(mask.vertices[2].y).toBeCloseTo(0.9);
    expect(mask.vertices[3].x).toBeCloseTo(0.1);
    expect(mask.vertices[3].y).toBeCloseTo(0.9);
  });

  it('addRectangleMask: rectangle vertices have zero bezier handles', () => {
    const maskId = store.getState().addRectangleMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.find(m => m.id === maskId)!;
    for (const v of mask.vertices) {
      expect(v.handleIn).toEqual({ x: 0, y: 0 });
      expect(v.handleOut).toEqual({ x: 0, y: 0 });
    }
  });

  it('addRectangleMask: coexists with existing masks', () => {
    store.getState().addMask('clip-1', { name: 'Existing' });
    store.getState().addRectangleMask('clip-1');
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(2);
    expect(masks[0].name).toBe('Existing');
    expect(masks[1].name).toBe('Rectangle Mask');
  });

  it('addEllipseMask: creates a closed mask with 4 bezier vertices', () => {
    const maskId = store.getState().addEllipseMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.find(m => m.id === maskId)!;
    expect(mask.name).toBe('Ellipse Mask');
    expect(mask.closed).toBe(true);
    expect(mask.vertices.length).toBe(4);
    // Top vertex should be at center-x, top of ellipse
    expect(mask.vertices[0].x).toBeCloseTo(0.5);
    expect(mask.vertices[0].y).toBeCloseTo(0.1);
    // Right vertex
    expect(mask.vertices[1].x).toBeCloseTo(0.9);
    expect(mask.vertices[1].y).toBeCloseTo(0.5);
    // Ellipse vertices should have non-zero bezier handles
    expect(mask.vertices[0].handleOut.x).not.toBe(0);
  });

  it('addEllipseMask: all 4 vertices are at correct positions', () => {
    const maskId = store.getState().addEllipseMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.find(m => m.id === maskId)!;
    const [top, right, bottom, left] = mask.vertices;
    // Top: (0.5, 0.1)
    expect(top.x).toBeCloseTo(0.5);
    expect(top.y).toBeCloseTo(0.1);
    // Right: (0.9, 0.5)
    expect(right.x).toBeCloseTo(0.9);
    expect(right.y).toBeCloseTo(0.5);
    // Bottom: (0.5, 0.9)
    expect(bottom.x).toBeCloseTo(0.5);
    expect(bottom.y).toBeCloseTo(0.9);
    // Left: (0.1, 0.5)
    expect(left.x).toBeCloseTo(0.1);
    expect(left.y).toBeCloseTo(0.5);
  });

  it('addEllipseMask: all vertices have non-zero bezier handles for curves', () => {
    const maskId = store.getState().addEllipseMask('clip-1');
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks!.find(m => m.id === maskId)!;
    for (const v of mask.vertices) {
      const handleInMag = Math.abs(v.handleIn.x) + Math.abs(v.handleIn.y);
      const handleOutMag = Math.abs(v.handleOut.x) + Math.abs(v.handleOut.y);
      expect(handleInMag).toBeGreaterThan(0);
      expect(handleOutMag).toBeGreaterThan(0);
    }
  });

  it('addEllipseMask: coexists with existing masks', () => {
    store.getState().addMask('clip-1', { name: 'Existing' });
    store.getState().addEllipseMask('clip-1');
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(2);
    expect(masks[0].name).toBe('Existing');
    expect(masks[1].name).toBe('Ellipse Mask');
  });

  // ─── closeMask ────────────────────────────────────────────────────

  it('closeMask: sets closed to true', () => {
    const maskId = store.getState().addMask('clip-1');
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(false);
    store.getState().closeMask('clip-1', maskId);
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(true);
  });

  it('closeMask: is idempotent on already-closed mask', () => {
    const maskId = store.getState().addMask('clip-1', { closed: true });
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(true);
    store.getState().closeMask('clip-1', maskId);
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(true);
  });

  it('closeMask: only closes the targeted mask', () => {
    const maskId1 = store.getState().addMask('clip-1');
    const maskId2 = store.getState().addMask('clip-1');
    store.getState().closeMask('clip-1', maskId2);
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.find(m => m.id === maskId1)!.closed).toBe(false);
    expect(masks.find(m => m.id === maskId2)!.closed).toBe(true);
  });

  // ─── setMaskDragging ───────────────────────────────────────────────

  it('setMaskDragging: sets dragging state to true', () => {
    expect(store.getState().maskDragging).toBe(false);
    store.getState().setMaskDragging(true);
    expect(store.getState().maskDragging).toBe(true);
  });

  it('setMaskDragging: sets dragging state to false', () => {
    store.getState().setMaskDragging(true);
    store.getState().setMaskDragging(false);
    expect(store.getState().maskDragging).toBe(false);
  });

  // ─── setMaskDrawStart ──────────────────────────────────────────────

  it('setMaskDrawStart: sets a draw start point', () => {
    store.getState().setMaskDrawStart({ x: 0.3, y: 0.7 });
    expect(store.getState().maskDrawStart).toEqual({ x: 0.3, y: 0.7 });
  });

  it('setMaskDrawStart: clears the draw start point with null', () => {
    store.getState().setMaskDrawStart({ x: 0.5, y: 0.5 });
    store.getState().setMaskDrawStart(null);
    expect(store.getState().maskDrawStart).toBeNull();
  });

  // ─── Mask edit mode & selection ───────────────────────────────────

  it('setMaskEditMode: sets mode and clears state on none', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().setActiveMask('clip-1', maskId);
    store.getState().selectVertex(vertexId);
    store.getState().setMaskEditMode('none');
    expect(store.getState().maskEditMode).toBe('none');
    expect(store.getState().activeMaskId).toBeNull();
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });

  it('setMaskEditMode: sets drawing mode without clearing activeMask', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId);
    store.getState().setMaskEditMode('drawing');
    expect(store.getState().maskEditMode).toBe('drawing');
    // activeMaskId should NOT be cleared for non-'none' modes
    expect(store.getState().activeMaskId).toBe(maskId);
  });

  it('setMaskEditMode: sets drawingRect mode', () => {
    store.getState().setMaskEditMode('drawingRect');
    expect(store.getState().maskEditMode).toBe('drawingRect');
  });

  it('setMaskEditMode: sets drawingEllipse mode', () => {
    store.getState().setMaskEditMode('drawingEllipse');
    expect(store.getState().maskEditMode).toBe('drawingEllipse');
  });

  it('setMaskEditMode: sets drawingPen mode', () => {
    store.getState().setMaskEditMode('drawingPen');
    expect(store.getState().maskEditMode).toBe('drawingPen');
  });

  it('setMaskEditMode: sets editing mode', () => {
    store.getState().setMaskEditMode('editing');
    expect(store.getState().maskEditMode).toBe('editing');
  });

  it('setMaskEditMode: always clears maskDrawStart', () => {
    store.getState().setMaskDrawStart({ x: 0.5, y: 0.5 });
    store.getState().setMaskEditMode('drawing');
    expect(store.getState().maskDrawStart).toBeNull();
  });

  it('setActiveMask: enters editing mode and clears vertex selection', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId);
    expect(store.getState().activeMaskId).toBe(maskId);
    expect(store.getState().maskEditMode).toBe('editing');
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });

  it('setActiveMask: with null clipId and null maskId clears active mask but preserves edit mode', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId);
    expect(store.getState().maskEditMode).toBe('editing');
    store.getState().setActiveMask(null, null);
    expect(store.getState().activeMaskId).toBeNull();
    expect(store.getState().selectedVertexIds.size).toBe(0);
    // maskEditMode is NOT changed by setActiveMask(null, null) - it stays as is
    expect(store.getState().maskEditMode).toBe('editing');
  });

  it('setActiveMask: with null values does not enter editing mode from none', () => {
    expect(store.getState().maskEditMode).toBe('none');
    store.getState().setActiveMask(null, null);
    expect(store.getState().activeMaskId).toBeNull();
    // Should not transition to 'editing' when both are null
    expect(store.getState().maskEditMode).toBe('none');
  });

  it('setActiveMask: clears previous vertex selection when switching masks', () => {
    const maskId1 = store.getState().addMask('clip-1');
    const maskId2 = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId1, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().setActiveMask('clip-1', maskId1);
    store.getState().selectVertex(v1);
    expect(store.getState().selectedVertexIds.size).toBe(1);
    store.getState().setActiveMask('clip-1', maskId2);
    expect(store.getState().activeMaskId).toBe(maskId2);
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });

  it('selectVertex: single and multi-select', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 0.9, y: 0.9, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });

    // Single select
    store.getState().selectVertex(v1);
    expect(store.getState().selectedVertexIds.size).toBe(1);
    expect(store.getState().selectedVertexIds.has(v1)).toBe(true);

    // Add to selection
    store.getState().selectVertex(v2, true);
    expect(store.getState().selectedVertexIds.size).toBe(2);
    expect(store.getState().selectedVertexIds.has(v2)).toBe(true);

    // Toggle off with addToSelection
    store.getState().selectVertex(v1, true);
    expect(store.getState().selectedVertexIds.size).toBe(1);
    expect(store.getState().selectedVertexIds.has(v1)).toBe(false);
  });

  it('selectVertex: single select replaces previous selection', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(v1);
    store.getState().selectVertex(v2); // without addToSelection
    expect(store.getState().selectedVertexIds.size).toBe(1);
    expect(store.getState().selectedVertexIds.has(v1)).toBe(false);
    expect(store.getState().selectedVertexIds.has(v2)).toBe(true);
  });

  it('selectVertex: multi-select three vertices', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0, y: 0, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v2 = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    const v3 = store.getState().addVertex('clip-1', maskId, { x: 1, y: 1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(v1);
    store.getState().selectVertex(v2, true);
    store.getState().selectVertex(v3, true);
    expect(store.getState().selectedVertexIds.size).toBe(3);
    expect(store.getState().selectedVertexIds.has(v1)).toBe(true);
    expect(store.getState().selectedVertexIds.has(v2)).toBe(true);
    expect(store.getState().selectedVertexIds.has(v3)).toBe(true);
  });

  it('deselectAllVertices: clears vertex selection', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(v1);
    expect(store.getState().selectedVertexIds.size).toBe(1);
    store.getState().deselectAllVertices();
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });

  it('deselectAllVertices: works when already empty', () => {
    expect(store.getState().selectedVertexIds.size).toBe(0);
    store.getState().deselectAllVertices();
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });

  // ─── Combined workflows ─────────────────────────────────────────────

  it('workflow: create mask, add vertices, close, then edit', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().addVertex('clip-1', maskId, { x: 0.9, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.9, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().closeMask('clip-1', maskId);
    store.getState().setActiveMask('clip-1', maskId);
    const mask = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0];
    expect(mask.vertices.length).toBe(3);
    expect(mask.closed).toBe(true);
    expect(store.getState().maskEditMode).toBe('editing');
    expect(store.getState().activeMaskId).toBe(maskId);
  });

  it('workflow: add/subtract mask combination', () => {
    store.getState().addMask('clip-1', { name: 'Base', mode: 'add' });
    store.getState().addMask('clip-1', { name: 'Hole', mode: 'subtract' });
    const masks = store.getState().getClipMasks('clip-1');
    expect(masks.length).toBe(2);
    expect(masks[0].mode).toBe('add');
    expect(masks[1].mode).toBe('subtract');
  });

  it('workflow: remove all masks from a clip', () => {
    const id1 = store.getState().addMask('clip-1');
    const id2 = store.getState().addMask('clip-1');
    const id3 = store.getState().addMask('clip-1');
    store.getState().removeMask('clip-1', id1);
    store.getState().removeMask('clip-1', id2);
    store.getState().removeMask('clip-1', id3);
    expect(store.getState().getClipMasks('clip-1')).toEqual([]);
  });

  it('workflow: reorder then update preserves correct mask', () => {
    const id1 = store.getState().addMask('clip-1', { name: 'A', opacity: 1 });
    store.getState().addMask('clip-1', { name: 'B', opacity: 1 });
    store.getState().addMask('clip-1', { name: 'C', opacity: 1 });
    // Move A to the end
    store.getState().reorderMasks('clip-1', 0, 2);
    // Update A (now at index 2) by id
    store.getState().updateMask('clip-1', id1, { opacity: 0.5 });
    const masks = store.getState().getClipMasks('clip-1');
    expect(masks[2].name).toBe('A');
    expect(masks[2].opacity).toBe(0.5);
    // Others unchanged
    expect(masks[0].opacity).toBe(1);
    expect(masks[1].opacity).toBe(1);
  });

  it('workflow: exit edit mode clears all editing state', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0.5, y: 0.5, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().setActiveMask('clip-1', maskId);
    store.getState().selectVertex(v1);
    store.getState().setMaskDragging(true);
    store.getState().setMaskDrawStart({ x: 0.1, y: 0.1 });
    // Exit edit mode
    store.getState().setMaskEditMode('none');
    expect(store.getState().maskEditMode).toBe('none');
    expect(store.getState().activeMaskId).toBeNull();
    expect(store.getState().selectedVertexIds.size).toBe(0);
    expect(store.getState().maskDrawStart).toBeNull();
  });
});
