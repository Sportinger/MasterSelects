import { describe, expect, it } from 'vitest';

import {
  MD2_EVIDENCE_IDS,
  MD2_EVIDENCE_SURFACES,
  createMd2EvidenceFixture,
} from '../../src/services/motionDesign/evidence/md2EvidenceFixture';

describe('MD2 evidence fixture', () => {
  it('exposes the exact deterministic evidence surface manifest and stable ids', () => {
    const fixture = createMd2EvidenceFixture();

    expect(fixture.surfaces).toEqual([
      'direct-preview',
      'direct-export',
      'nested-preview',
      'nested-export',
      'global-graph',
      'motion-path-overlay',
    ]);
    expect(fixture.surfaces).toBe(MD2_EVIDENCE_SURFACES);
    expect(fixture.ids).toBe(MD2_EVIDENCE_IDS);
    expect(fixture.width).toBe(640);
    expect(fixture.height).toBe(360);
    expect(fixture.duration).toBe(2);
    expect(fixture.sampleTime).toBe(0.32);
  });

  it('builds one editable lower-third rectangle and an isolated nested wrapper', () => {
    const fixture = createMd2EvidenceFixture();
    const direct = fixture.clips[0]!;
    const nested = fixture.nestedClips[0]!;

    expect(fixture.tracks).toEqual([
      expect.objectContaining({ id: fixture.ids.trackId, type: 'video', locked: false }),
    ]);
    expect(direct).toMatchObject({
      id: fixture.ids.clipId,
      trackId: fixture.ids.trackId,
      duration: fixture.duration,
      source: { type: 'motion-shape', naturalDuration: fixture.duration },
      motion: {
        kind: 'shape',
        shape: { primitive: 'rectangle', size: { w: 432, h: 88 }, cornerRadius: 18 },
        ui: { pinnedProperties: ['position.x', 'position.y', 'opacity'] },
      },
    });
    expect(fixture.keyframes.size).toBe(0);

    expect(nested).toMatchObject({
      id: fixture.ids.nestedClipId,
      trackId: fixture.ids.nestedTrackId,
      source: { type: 'motion-shape' },
    });
    expect(nested).not.toBe(direct);
    expect(nested.motion).not.toBe(direct.motion);
    expect(fixture.nestedWrapperClip).toMatchObject({
      id: fixture.ids.nestedWrapperClipId,
      trackId: fixture.ids.nestedWrapperTrackId,
      isComposition: true,
      compositionId: fixture.ids.nestedCompositionId,
    });
    expect(fixture.nestedWrapperClip.nestedTracks).toBe(fixture.nestedTracks);
    expect(fixture.nestedWrapperClip.nestedClips).toBe(fixture.nestedClips);
    expect(fixture.directComposition).toMatchObject({
      id: fixture.ids.compositionId,
      width: fixture.width,
      height: fixture.height,
      frameRate: 30,
      duration: fixture.duration,
    });
    expect(fixture.nestedComposition).toMatchObject({
      id: fixture.ids.nestedCompositionId,
      width: fixture.width,
      height: fixture.height,
      frameRate: 30,
      duration: fixture.duration,
    });
  });

  it('provides a production addKeyframe-compatible slide, overshoot, settle, and hold sequence', () => {
    const fixture = createMd2EvidenceFixture();
    const sequence = fixture.expectedSequence;

    expect(sequence).toHaveLength(15);
    expect(sequence.filter((entry) => entry.property === 'position.x')).toEqual([
      { property: 'position.x', time: 0, value: -420, easing: 'ease-out' },
      { property: 'position.x', time: 0.32, value: 28, easing: 'ease-in-out' },
      { property: 'position.x', time: 0.48, value: 0, easing: 'ease-in-out' },
      { property: 'position.x', time: 1.2, value: 0, easing: 'linear' },
      { property: 'position.x', time: 1.6, value: 0, easing: 'linear' },
    ]);
    expect(sequence.filter((entry) => entry.property === 'position.y').map((entry) => entry.value))
      .toEqual([108, 108, 108, 108, 108]);
    expect(sequence.filter((entry) => entry.property === 'opacity').map((entry) => entry.value))
      .toEqual([0, 1, 1, 1, 1]);

    for (const entry of sequence) {
      expect(entry.time).toBeGreaterThanOrEqual(0);
      expect(entry.time).toBeLessThanOrEqual(fixture.duration);
      expect(Number.isFinite(entry.value)).toBe(true);
    }
    expect(new Set(sequence.map((entry) => `${entry.property}:${entry.time}`)).size)
      .toBe(sequence.length);
  });

  it('returns fresh mutable fixture data on every call', () => {
    const first = createMd2EvidenceFixture();
    const second = createMd2EvidenceFixture();

    first.clips[0]!.motion!.shape!.size.w = 1;
    (first.expectedSequence[0] as { value: number }).value = 999;
    first.nestedTracks[0]!.name = 'mutated';

    expect(second.clips[0]!.motion!.shape!.size.w).toBe(432);
    expect(second.expectedSequence[0]!.value).toBe(-420);
    expect(second.nestedTracks[0]!.name).toBe('MD2 Nested Lower Third');
  });
});
