import type { NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';
import { encloseNodeGroup } from './groupBounds';
import { spacePreviewBlocks, spacePreviewNodes, type PreviewLayoutBlock } from './spacePreviewNodes';
import { connectedFlowBlocks, flowGroupLayout } from './flowGroupLayout';

interface GroupBlock extends PreviewLayoutBlock { nodeIds: string[]; group: boolean; growing?: boolean; flow?: boolean; source?: boolean }

/** Pack from the innermost group outward. Siblings must avoid the entire expanded
 * frame, including its empty space, header and nested frames, not just its cards.
 * Folding is projected first, so each pass uses the current proxy or contents.
 */
export function spacePreviewGroups(graph: NodeGraph, fixedIds: ReadonlySet<string> = new Set(), expanding: ReadonlySet<string> = new Set(),
  displacements?: Map<string, NodeGraphLayout>, outer?: { reflow: boolean; groupMoves: Map<string, NodeGraphLayout> }): NodeGraphNode[] {
  if (!graph.groups?.length && !fixedIds.size) return spacePreviewNodes(graph.nodes);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const groups = new Map((graph.groups ?? []).map(group => [group.id, group]));
  const children = new Map<string | undefined, NonNullable<NodeGraph['groups']>>();
  for (const group of graph.groups ?? []) {
    const parent = group.parentId && groups.has(group.parentId) ? group.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), group]);
  }
  const layout = (id?: string, inheritedFlow = false): GroupBlock | undefined => {
    const group = id ? groups.get(id) : undefined;
    const flow = inheritedFlow || group?.layoutMode === 'flow';
    const listedIds = (group?.nodeIds ?? graph.nodes.map(node => node.id)).filter(nodeId => nodes.has(nodeId));
    const nested = (group?.collapsed ? [] : children.get(id) ?? []).flatMap(child => {
      const block = layout(child.id, flow); return block ? [block] : [];
    });
    const nestedIds = new Set(nested.flatMap(block => block.nodeIds));
    const memberIds = [...new Set([...listedIds, ...nestedIds])];
    const blocks: GroupBlock[] = [...nested, ...memberIds.filter(nodeId => !nestedIds.has(nodeId)).map(nodeId => {
      const node = nodes.get(nodeId)!;
      return { id: `node:${nodeId}`, ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node), nodeIds: [nodeId], group: false,
        source: !node.inputs.length };
    })];
    const fixed = new Set(blocks.filter(block => block.nodeIds.some(nodeId => fixedIds.has(nodeId))).map(block => block.id));
    const arrange = flow || (!id && graph.groups?.some(group => group.layoutMode === 'flow'));
    const outerFlow = !id && arrange ? connectedFlowBlocks(blocks, graph.edges) : new Set<string>();
    if (outer?.reflow) for (const blockId of outerFlow) fixed.delete(blockId);
    const source = !id ? blocks.find(block => block.nodeIds.some(nodeId => nodes.get(nodeId)?.binding?.kind === 'clip-source')) : undefined;
    const flowing = !id ? blocks.filter(block => outerFlow.has(block.id)) : blocks;
    const flowPositions = new Map((arrange ? flowGroupLayout(flowing, graph.edges, fixed, source) : flowing).map(block => [block.id, block]));
    const arranged = blocks.map(block => flowPositions.get(block.id) ?? block);
    const growing = arranged.filter(block => block.growing);
    const displaced = new Set<string>();
    if (growing.length) {
      // Expansion owns its new frame. Unrelated cards/groups caught by it must
      // move out even if their previous positions were explicit user anchors.
      for (const block of arranged) {
        if (block.growing) { fixed.add(block.id); continue; }
        if (growing.some(other => block.x < other.x + other.width && block.x + block.width > other.x
          && block.y < other.y + other.height && block.y + block.height > other.y)) { fixed.delete(block.id); displaced.add(block.id); }
      }
    }
    const placed = spacePreviewBlocks(arranged, fixed);
    const childBounds = [];
    for (let index = 0; index < blocks.length; index++) {
      const before = blocks[index], after = placed[index], dx = after.x - before.x, dy = after.y - before.y;
      if ((dx || dy) && before.group && outerFlow.has(before.id) && (outer?.reflow || before.flow))
        outer?.groupMoves.set(before.id.slice('group:'.length), { x: dx, y: dy });
      if (dx || dy) for (const nodeId of before.nodeIds) {
        const node = nodes.get(nodeId)!;
        if (displaced.has(before.id) && !displacements?.has(nodeId)) displacements?.set(nodeId, node.layout);
        nodes.set(nodeId, { ...node, layout: { x: node.layout.x + dx, y: node.layout.y + dy } });
      }
      if (before.group) childBounds.push({ left: after.x, top: after.y, right: after.x + after.width, bottom: after.y + after.height });
    }
    if (!group || !memberIds.length) return;
    const members = memberIds.map(nodeId => nodes.get(nodeId)!);
    const bounds = group.collapsed ? { left: Math.min(...members.map(node => node.layout.x)), top: Math.min(...members.map(node => node.layout.y)),
      right: Math.max(...members.map(node => node.layout.x + NODE_WIDTH)), bottom: Math.max(...members.map(node => node.layout.y + getNodeHeight(node))) }
      : encloseNodeGroup(members, childBounds);
    return { id: `group:${group.id}`, nodeIds: memberIds, group: true, flow: flow || nested.some(block => block.flow), growing: expanding.has(group.id) || nested.some(block => block.growing),
      x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  };
  layout();
  return graph.nodes.map(node => nodes.get(node.id)!);
}
