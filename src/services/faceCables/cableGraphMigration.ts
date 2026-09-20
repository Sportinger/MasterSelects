import type { EffectOperatorGraph } from '../../types/operatorGraph';

/** Pure, idempotent migration. Existing bakes and source tracking are not changed. */
export function migrateCableGraph(saved: EffectOperatorGraph): EffectOperatorGraph {
  if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges) || !saved.layout
    || saved.nodes.some(n => !n) || saved.edges.some(e => !e)) return saved;
  const graph = structuredClone(saved);
  const unique = (name: string) => { let id = name, suffix = 1; while (graph.nodes.some(n => n.id === id)) id = `${name}-${suffix++}`; return id; };
  const connect = (from: string, output: string, to: string, input: string) => {
    let id = `${from}-${to}-${input}`; while (graph.edges.some(e => e.id === id)) id += '-new';
    graph.edges.push({ id, from, output, to, input });
  };
  const tracking = graph.nodes.find(n => n.operator === 'tracking.face');
  if (!graph.domain && tracking && !graph.nodes.some(n => n.operator === 'tracking.smooth')) {
    const id = unique('smoothing');
    graph.nodes.push({ id, operator: 'tracking.smooth', bindings: { strength: 'trackingSmoothing' } });
    for (const e of graph.edges) if (e.from === tracking.id && e.output === 'landmarks') e.from = id;
    connect(tracking.id, 'landmarks', id, 'landmarks');
    const position = graph.layout[tracking.id] ?? { x: 250, y: 0 };
    for (const [nodeId, layout] of Object.entries(graph.layout)) if (nodeId !== tracking.id && layout.x >= position.x + 200) layout.x += 250;
    graph.layout[id] = { x: position.x + 250, y: position.y };
    graph.groups?.find(g => g.nodeIds.includes(tracking.id))?.nodeIds.push(id);
  }
  for (const surface of graph.nodes.filter(n => n.operator === 'surface.hybrid')) {
    const landmark = graph.edges.find(e => e.to === surface.id && e.input === 'landmarks');
    if (!landmark) continue; // Validation reports missing required inputs.
    const depth = graph.edges.find(e => e.to === surface.id && e.input === 'depth');
    const faceId = unique('face-mesh'); graph.nodes.push({ id: faceId, operator: 'geometry.face', bindings: {} });
    const calibrationId = unique('calibration'); graph.nodes.push({ id: calibrationId, operator: 'depth.calibrate', bindings: { strength: 'sceneDepthStrength' } });
    const depthId = unique('depth-mesh'); graph.nodes.push({ id: depthId, operator: 'geometry.depth', bindings: {} });
    const pos = graph.layout[surface.id] ?? { x: 750, y: 440 };
    graph.layout[faceId] = { x: pos.x, y: pos.y };
    graph.layout[calibrationId] = { x: pos.x + 250, y: pos.y + 260 };
    graph.layout[depthId] = { x: pos.x + 500, y: pos.y + 260 };
    for (const [id, layout] of Object.entries(graph.layout)) if (![faceId, calibrationId, depthId, surface.id].includes(id) && layout.x > pos.x) layout.x += 750;
    graph.layout[surface.id] = { x: pos.x + 750, y: pos.y };
    graph.groups?.find(g => g.nodeIds.includes(surface.id))?.nodeIds.push(faceId, calibrationId, depthId);
    graph.edges = graph.edges.filter(e => e.to !== surface.id);
    connect(landmark.from, landmark.output, faceId, 'landmarks');
    connect(faceId, 'geometry', calibrationId, 'reference');
    if (depth) connect(depth.from, depth.output, calibrationId, 'depth');
    connect(calibrationId, 'depth', depthId, 'depth');
    connect(faceId, 'geometry', surface.id, 'primary'); connect(depthId, 'geometry', surface.id, 'background');
    surface.operator = 'geometry.merge-surface'; surface.bindings = { blendWidth: 'surfaceBlendWidth', subdivisions: 'surfaceSubdivisions' };
    for (const e of graph.edges) if (e.from === surface.id) e.output = 'geometry';
    for (const contact of graph.nodes.filter(n => n.operator === 'collision.face')) {
      const source = graph.edges.find(e => e.to === contact.id && e.input === 'landmarks');
      if (source?.from === landmark.from) { source.from = faceId; source.output = 'geometry'; source.input = 'geometry'; contact.operator = 'collision.mesh'; }
    }
    for (const contact of graph.nodes.filter(n => n.operator === 'collision.surface')) {
      const source = graph.edges.find(e => e.to === contact.id && e.input === 'surface');
      if (source?.from === surface.id) { source.input = 'geometry'; contact.operator = 'collision.mesh'; }
    }
  }
  graph.domain ??= 'cables';
  return graph;
}
