import type { BeatRuleMember, CompositionRule, UnknownCompositionRule } from '../../../types/compositionGraph';
import type { NodeGraph, NodeGraphNode } from '../../../types/nodeGraph';
import { compositionNodeId, type CompositionGraphProjectionInput } from './compositionGraphProjection';
import { compositionEdge, compositionNode, compositionPort } from './compositionGraphPrimitives';
import { compositionClipOutputPort } from './compositionGraphClipPairs';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Unknown versions remain inspectable; only the known, well-shaped schema gets editable ports. */
function knownRule(rule: CompositionRule | UnknownCompositionRule): rule is CompositionRule {
  return rule.operator === 'beat-distribute' && rule.schemaVersion === 1
    && record(rule.params) && typeof rule.params.targetTrackId === 'string'
    && record(rule.source) && (rule.source.kind === 'tempo-map' || rule.source.kind === 'clip-beat-grid')
    && Array.isArray(rule.beatSnapshot) && Array.isArray(rule.members)
    && rule.members.every(member => record(member) && typeof member.memberId === 'string' && typeof member.clipId === 'string')
    && record(rule.status) && ['ok', 'stale', 'locked'].includes(String(rule.status.state));
}

export function projectCompositionRules(
  input: CompositionGraphProjectionInput, graph: NodeGraph, clips: ReadonlyMap<string, NodeGraphNode>, y: number,
): void {
  let row = 0;
  for (const [key, rule] of Object.entries(input.state?.rules ?? {})) {
    const id = rule.id || key;
    const known = knownRule(rule);
    const status = record(rule.status) ? rule.status : undefined;
    const locked = !known || status?.state === 'locked';
    const members: BeatRuleMember[] = Array.isArray(rule.members)
      ? rule.members.filter((member): member is BeatRuleMember => record(member)
        && typeof member.memberId === 'string' && typeof member.clipId === 'string') : [];
    const missing = members.some(member => !clips.has(member.clipId));
    const sourceMissing = known && rule.source.kind === 'clip-beat-grid' && !clips.has(rule.source.clipId);
    const stale = status?.state === 'stale' || missing || sourceMissing;

    const node = compositionNode(input.state, compositionNodeId.rule(id), rule.label || rule.operator,
      { kind: 'composition-rule', ruleId: id }, { x: 740, y: y + row * 260 },
      [compositionPort('members', 'Members', 'clip', 'input', { readOnly: true, repeated: true,
        contract: { typeLabel: 'Ordered members', description: 'Clip references in stored member order; repeated references are retained.',
          formats: ['clip'], constraints: ['ordered', 'repeated'] } })],
      [compositionPort('place', 'Place', 'time', 'output', { readOnly: true })]);
    node.summary = { badges: [rule.operator, ...(!known ? ['Unknown'] : []),
      ...(locked ? ['Locked'] : []), ...(stale ? ['Stale'] : [])] };
    node.description = typeof status?.reason === 'string' ? status.reason
      : 'Stored arrangement rule; viewing never evaluates or applies it.';
    if (known) node.params = { firstBeat: rule.params.firstBeat, beatStep: rule.params.beatStep,
      offset: rule.params.offset, targetTrackId: rule.params.targetTrackId, sourceRevision: rule.sourceRevision };
    graph.nodes.push(node);
    if (rule.operator === 'beat-distribute') {
      node.inputs.unshift(compositionPort('beats', 'Beats', 'event', 'input', { readOnly: true }));
      const source = compositionNode(input.state, compositionNodeId.beatSource(id), 'Beat-Source',
        { kind: 'composition-beat-source', ruleId: id }, { x: 420, y: y + row * 260 }, [],
        [compositionPort('beats', 'Beats', 'event', 'output', { readOnly: true, semanticKind: 'beats',
          ...(known && rule.source.kind === 'clip-beat-grid' ? { targetClipId: rule.source.clipId,
            artifactId: rule.source.artifactId, artifactProvenance: rule.source.provenance } : {}),
          available: !sourceMissing, stale })]);
      source.summary = { badges: [known ? rule.source.kind : 'Unknown', ...(stale ? ['Stale'] : [])] };
      if (known) source.params = { beats: rule.beatSnapshot.length, sourceRevision: rule.sourceRevision };
      if (known && rule.source.kind === 'clip-beat-grid') {
        source.inputs.push(compositionPort('audio', 'Audio', 'clip', 'input', { readOnly: true,
          targetClipId: rule.source.clipId,
          contract: { typeLabel: 'Analysis source', description: 'Audio-bearing clip used to analyze this beat grid; not image processing or audio routing.', formats: ['clip'] } }));
        const sourceClip = clips.get(rule.source.clipId);
        if (sourceClip) graph.edges.push(compositionEdge(sourceClip.id,
          compositionClipOutputPort(sourceClip, rule.source.clipId), source.id, 'audio', 'clip', true));
      }
      graph.nodes.push(source);
      graph.edges.push(compositionEdge(source.id, 'beats', node.id, 'beats', 'event'));
    }
    members.forEach((member, index) => {
      const clip = clips.get(member.clipId);
      if (!clip) return;
      const badges = new Set(clip.summary?.badges ?? []);
      badges.add('Rule');
      if (record(member.correction) && (member.correction.startOffset !== undefined || member.correction.trackId !== undefined)) badges.add('Correction');
      clip.summary = { ...clip.summary, badges: [...badges] };
      const identity = `${member.memberId}:${index}`;
      // Membership and order are edited in the rule inspector; v1 rule cables are not rewirable.
      graph.edges.push(
        compositionEdge(clip.id, compositionClipOutputPort(clip, member.clipId), node.id, 'members', 'clip', true, identity),
        compositionEdge(node.id, 'place', clip.id, 'place', 'time', true, identity),
      );
    });
    row += 1;
  }
}
