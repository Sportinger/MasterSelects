import type { NodeGraph, NodeGraphLayout, NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';
import { encloseNodeGroup, withGroupSize } from './groupBounds';
import { PREVIEW_BLOCK_GAP, spacePreviewBlocks, spacePreviewNodes, type PreviewLayoutBlock } from './spacePreviewNodes';
import { connectedFlowBlocks, flowGroupLayout } from './flowGroupLayout';
import { compactFlowColumns } from './compactFlowColumns';

interface GroupBlock extends PreviewLayoutBlock { nodeIds: string[]; group: boolean; growing?: boolean; flow?: boolean; source?: boolean; boundary?: 'input' | 'output' }

/** Within the clearance that would make spacePreviewBlocks move one of them. */
const crowds = (a: PreviewLayoutBlock, b: PreviewLayoutBlock) => a.x < b.x + b.width + PREVIEW_BLOCK_GAP
  && a.x + a.width + PREVIEW_BLOCK_GAP > b.x && a.y < b.y + b.height + PREVIEW_BLOCK_GAP && a.y + a.height + PREVIEW_BLOCK_GAP > b.y;

/** Pack from the innermost group outward. Siblings must avoid the entire expanded
 * frame, including its empty space, header and nested frames, not just its cards.
 * Folding is projected first, so each pass uses the current proxy or contents.
 */
export function spacePreviewGroups(graph: NodeGraph, fixedIds: ReadonlySet<string> = new Set(), expanding: ReadonlySet<string> = new Set(),
  displacements?: Map<string, NodeGraphLayout>, outer?: { reflow: boolean; reflowFromSource?: boolean; compactEffects?: boolean; addedEffects?: ReadonlySet<string>; groupMoves: Map<string, NodeGraphLayout> }): NodeGraphNode[] {
  // Free-standing groups stay where they were placed; the chain flows around them.
  const detachedBlocks = new Set((graph.groups ?? []).filter(group => group.detached).map(group => `group:${group.id}`));
  if (!graph.groups?.length && !fixedIds.size && !outer?.reflow) return spacePreviewNodes(graph.nodes);
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
    const blocks: GroupBlock[] = [...nested, ...memberIds.filter(nodeId => !nestedIds.has(nodeId)).map((nodeId): GroupBlock => {
      const node = nodes.get(nodeId)!;
      return { id: `node:${nodeId}`, ...node.layout, width: NODE_WIDTH, height: getNodeHeight(node), nodeIds: [nodeId], group: false,
        source: !node.inputs.length,
        boundary: node.binding?.kind === 'clip-source' ? 'input' : node.binding?.kind === 'clip-output' ? 'output' : undefined };
    })];
    const fixed = new Set(blocks.filter(block => block.nodeIds.some(nodeId => fixedIds.has(nodeId))).map(block => block.id));
    const arrange = flow || (!id && (outer?.reflowFromSource || outer?.addedEffects?.size || graph.groups?.some(group => group.layoutMode === 'flow')));
    const outerFlow = !id && arrange ? connectedFlowBlocks(blocks.map(block => ({
      ...block,
      flow: block.flow || (outer?.reflowFromSource && block.boundary === 'input') || block.nodeIds.some(nodeId => outer?.addedEffects?.has(nodeId))
        || (block.group && !!outer?.addedEffects?.has(groups.get(block.id.slice('group:'.length))!.proxyId)),
    })), graph.edges) : new Set<string>();
    if (!id) for (const blockId of detachedBlocks) { outerFlow.delete(blockId); if (blocks.some(block => block.id === blockId)) fixed.add(blockId); }
    if (outer?.reflow) for (const blockId of outerFlow) fixed.delete(blockId);
    const source = !id ? blocks.find(block => block.nodeIds.some(nodeId => nodes.get(nodeId)?.binding?.kind === 'clip-source')) : undefined;
    const flowing = !id ? blocks.filter(block => outerFlow.has(block.id)) : blocks;
    const arrangeFlow = () => {
      const flowLayout = arrange ? flowGroupLayout(flowing, graph.edges, fixed, source) : flowing;
      const flowPositions = new Map((!id && arrange && outer?.compactEffects !== false ? compactFlowColumns(flowLayout, fixed) : flowLayout).map(block => [block.id, block]));
      return blocks.map(block => flowPositions.get(block.id) ?? block);
    };
    let arranged = arrangeFlow();
    // A pinned clip output must not push a re-flowing effect frame below it:
    // when the frame grows into the output, the output follows the chain instead.
    const blocked = !id ? arranged.filter(block => block.boundary === 'output' && fixed.has(block.id) && arranged.some(other =>
      other.group && !fixed.has(other.id) && outerFlow.has(other.id) && crowds(block, other))) : [];
    if (blocked.length) { blocked.forEach(block => fixed.delete(block.id)); arranged = arrangeFlow(); }
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
      : withGroupSize(encloseNodeGroup(members, childBounds), group.size);
    return { id: `group:${group.id}`, nodeIds: memberIds, group: true, flow: flow || nested.some(block => block.flow), growing: expanding.has(group.id) || nested.some(block => block.growing),
      x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  };
  layout();
  return graph.nodes.map(node => nodes.get(node.id)!);
}
