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

  // ─── Multiple masks per clip ──────────────────────────────────────

  it('supports multiple masks on the same clip', () => {
    store.getState().addMask('clip-1', { name: 'A', mode: 'add' });
    store.getState().addMask('clip-1', { name: 'B', mode: 'subtract' });
    store.getState().addMask('clip-1', { name: 'C', mode: 'intersect' });
    const masks = store.getState().clips.find(c => c.id === 'clip-1')!.masks!;
    expect(masks.length).toBe(3);
    expect(masks.map(m => m.mode)).toEqual(['add', 'subtract', 'intersect']);
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

  // ─── getClipMasks ─────────────────────────────────────────────────

  it('getClipMasks: returns masks for a clip, empty array for unknown clip', () => {
    store.getState().addMask('clip-1');
    expect(store.getState().getClipMasks('clip-1').length).toBe(1);
    expect(store.getState().getClipMasks('nonexistent')).toEqual([]);
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

  it('updateVertex: moves a vertex to new coordinates', () => {
    const maskId = store.getState().addMask('clip-1');
    const vertexId = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().updateVertex('clip-1', maskId, vertexId, { x: 0.9, y: 0.8 });
    const vertex = store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].vertices[0];
    expect(vertex.x).toBe(0.9);
    expect(vertex.y).toBe(0.8);
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

  // ─── closeMask ────────────────────────────────────────────────────

  it('closeMask: sets closed to true', () => {
    const maskId = store.getState().addMask('clip-1');
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(false);
    store.getState().closeMask('clip-1', maskId);
    expect(store.getState().clips.find(c => c.id === 'clip-1')!.masks![0].closed).toBe(true);
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

  it('setActiveMask: enters editing mode and clears vertex selection', () => {
    const maskId = store.getState().addMask('clip-1');
    store.getState().setActiveMask('clip-1', maskId);
    expect(store.getState().activeMaskId).toBe(maskId);
    expect(store.getState().maskEditMode).toBe('editing');
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

  it('deselectAllVertices: clears vertex selection', () => {
    const maskId = store.getState().addMask('clip-1');
    const v1 = store.getState().addVertex('clip-1', maskId, { x: 0.1, y: 0.1, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } });
    store.getState().selectVertex(v1);
    expect(store.getState().selectedVertexIds.size).toBe(1);
    store.getState().deselectAllVertices();
    expect(store.getState().selectedVertexIds.size).toBe(0);
  });
});
