import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { TransitionCompositionLink, TransitionSourceMapV2 } from '../../src/types/timelineCore';
import { deriveCompositionTransitionParents } from '../../src/services/nodeGraph/composition/compositionTransitionParents';
import { buildCompositionGraph, compositionNodeId } from '../../src/services/nodeGraph/composition/compositionGraphProjection';
import { createMockClip, createMockKeyframe, createMockTrack, createMockTransform } from '../helpers/mockData';

const link: TransitionCompositionLink = {
  kind: 'transition-comp', sourceLayout: 'mapped-v3', parentCompositionId: 'main', parentTransitionId: 'transition',
  parentOutgoingClipId: 'parent-a', parentIncomingClipId: 'parent-b',
  linkedOutgoingClipId: 'linked-a', linkedIncomingClipId: 'linked-b', innerTransitionId: '',
  paddingBefore: 0, paddingAfter: 0, bodyStart: 0, bodyEnd: 2,
};

function sourceMap(inPoint = 0): TransitionSourceMapV2 {
  return {
    version: 2, mediaDuration: 20,
    parent: { duration: 5, inPoint, outPoint: inPoint + 5, defaultSpeed: 1,
      animation: { baseTransform: createMockTransform(), keyframes: [], sourceEffectIds: [], sourceMaskIds: [] } },
    segments: [{ kind: 'parent-linear', compStart: 0, compEnd: 2, parentStart: 3, parentEnd: 5 }],
  };
}

function sources() {
  return [
    createMockClip({ id: link.linkedOutgoingClipId, mediaFileId: 'shared', transitionSourceMap: sourceMap() }),
    createMockClip({ id: link.linkedIncomingClipId, mediaFileId: 'shared', transitionSourceMap: sourceMap(5) }),
  ];
}

describe('transition composition parent references', () => {
  it('resolves linked roles even when both parents share media, without mutating the input', () => {
    const clips = sources();
    const before = JSON.stringify({ clips, link });
    expect([...deriveCompositionTransitionParents(clips, link)]).toEqual([
      ['linked-a', { parentClipId: 'parent-a', role: 'outgoing' }],
      ['linked-b', { parentClipId: 'parent-b', role: 'incoming' }],
    ]);
    expect(JSON.stringify({ clips, link })).toBe(before);
    expect(deriveCompositionTransitionParents(clips, undefined).size).toBe(0);
  });

  it('resolves generated panels when the original linked clips were replaced', () => {
    const [outgoing, incoming] = sources();
    const clips = [
      { ...outgoing, id: 'linked-a:panel:0:0' },
      { ...outgoing, id: 'linked-a:panel:1:2' },
      { ...incoming, id: 'linked-b:panel:0:0' },
      createMockClip({ id: 'overlay', mediaFileId: 'shared' }),
      createMockClip({ id: 'linked-a:unrelated' }),
    ];
    expect([...deriveCompositionTransitionParents(clips, link)]).toEqual([
      ['linked-a:panel:0:0', { parentClipId: 'parent-a', role: 'outgoing', panel: '1, 1' }],
      ['linked-a:panel:1:2', { parentClipId: 'parent-a', role: 'outgoing', panel: '2, 3' }],
      ['linked-b:panel:0:0', { parentClipId: 'parent-b', role: 'incoming', panel: '1, 1' }],
    ]);
  });

  it('matches remapped panels by media and parent timing while ignoring rebased animation IDs', () => {
    const clips = sources();
    const map = sourceMap(5);
    map.parent.animation.keyframes = [createMockKeyframe({ clipId: 'remapped-panel', id: 'remapped-panel:kf' })];
    clips.push(createMockClip({ id: 'remapped-panel', mediaFileId: 'shared', transitionSourceMap: map,
      sourceRect: { x: 0, y: 0, width: 0.5, height: 0.5 } }));
    expect(deriveCompositionTransitionParents(clips, link).get('remapped-panel')).toEqual({
      parentClipId: 'parent-b', role: 'incoming', panel: 'slice',
    });
    clips[2] = { ...clips[2], mediaFileId: 'unrelated' };
    expect(deriveCompositionTransitionParents(clips, link).has('remapped-panel')).toBe(false);
  });

  it('does not guess ambiguous same-media, same-clock references or unmapped overlays', () => {
    const clips: TimelineClip[] = sources().map(clip => ({ ...clip, transitionSourceMap: sourceMap() }));
    clips.push(createMockClip({ id: 'ambiguous', mediaFileId: 'shared', transitionSourceMap: sourceMap() }));
    const parents = deriveCompositionTransitionParents(clips, link);
    expect(parents.size).toBe(2);
    expect(parents.has('ambiguous')).toBe(false);
    expect(deriveCompositionTransitionParents([
      ...clips, createMockClip({ id: 'overlay', mediaFileId: 'shared' }),
    ], link).has('overlay')).toBe(false);
  });

  it('supports legacy v1 mapped sources and plain serialized clips', () => {
    const map = { version: 1 as const, segments: [
      { kind: 'linear' as const, compStart: 0, compEnd: 2, sourceStart: 3, sourceEnd: 5 },
    ] };
    const clips = [{ id: 'linked-a', mediaFileId: 'media-a', transitionSourceMap: map },
      { id: 'legacy-copy', mediaFileId: 'media-a', transitionSourceMap: structuredClone(map) }];
    expect(deriveCompositionTransitionParents(clips, link).get('legacy-copy')).toEqual({
      parentClipId: 'parent-a', role: 'outgoing',
    });
  });

  it('projects parent IDs, role/panel badges and read-only time chains without changing timeline data', () => {
    const clips = [...sources(), createMockClip({ id: 'linked-b:panel:0:1', mediaFileId: 'shared',
      transitionSourceMap: sourceMap(5) }), createMockClip({ id: 'overlay' })];
    const before = JSON.stringify(clips);
    const graph = buildCompositionGraph({ compositionId: 'transition-comp', compositionName: 'Transition',
      clips, tracks: [createMockTrack({ id: 'video-1' })], media: new Map(), transitionLink: link,
      transitionSourceParents: deriveCompositionTransitionParents(clips, link),
      expandedTimeChains: new Set(clips.map(clip => clip.id)),
    });
    for (const [id, parentClipId, role] of [
      ['linked-a', 'parent-a', 'Outgoing'], ['linked-b', 'parent-b', 'Incoming'],
      ['linked-b:panel:0:1', 'parent-b', 'Incoming'],
    ]) {
      const node = graph.nodes.find(candidate => candidate.id === compositionNodeId.clip(id));
      expect(node?.params).toMatchObject({ parentClipId, parentCompositionId: 'main', transitionRole: role.toLowerCase() });
      expect(node?.summary?.badges).toContain(role);
      for (const stage of ['slice', 'speed', 'place'] as const) {
        expect(graph.nodes.find(candidate => candidate.id === compositionNodeId.timeChain(id, stage))?.params?.readOnly).toBe(true);
      }
    }
    const panel = graph.nodes.find(node => node.id === compositionNodeId.clip('linked-b:panel:0:1'));
    expect(panel?.summary?.badges).toContain('Panel 1, 2');
    const overlay = graph.nodes.find(node => node.id === compositionNodeId.clip('overlay'));
    expect(overlay?.params).not.toHaveProperty('parentClipId');
    expect(overlay?.params).not.toHaveProperty('parentCompositionId');
    expect(JSON.stringify(clips)).toBe(before);
  });

  it('keeps the existing string parent-map projection input compatible', () => {
    const graph = buildCompositionGraph({ compositionId: 'body', compositionName: 'Body', clips: sources(),
      tracks: [createMockTrack({ id: 'video-1' })], media: new Map(), transitionLink: link,
      transitionSourceParents: new Map([['linked-a', 'parent-a']]),
    });
    expect(graph.nodes.find(node => node.id === compositionNodeId.clip('linked-a'))?.params).toMatchObject({
      parentClipId: 'parent-a', parentCompositionId: 'main', transitionRole: 'outgoing',
    });
  });
});
