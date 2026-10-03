// Composition-level node workspace contract (Timeline Node Graph plan, phases 1–3).
// The timeline clips stay the only executable truth: this state stores view layout
// and arrangement-rule definitions only. Clip values written by a rule are a derived
// projection of rule + corrections, never a second editable copy.

import type { NodeGraphLayout } from './nodeGraph';

/** Workspace context: a clip graph (level 1) or the composition view (level 0). */
export type NodeWorkspaceContext =
  | { kind: 'clip'; clipId: string }
  | { kind: 'composition'; compositionId: string };

/** View preferences of the composition graph. Never read by rendering, playback or export. */
export interface CompositionGraphLayout {
  /** Manually placed node positions, keyed by projected node id. */
  nodes: Record<string, NodeGraphLayout>;
  /** Folded state per projected group id (for example the `Media (n)` group or a clip time chain). */
  collapsed?: Record<string, boolean>;
}

export const BEAT_DISTRIBUTE_RULE_SCHEMA_VERSION = 1 as const;

/** Where the beats of a rule come from. Times in the snapshot are timeline seconds. */
export type BeatRuleSource =
  | {
      kind: 'clip-beat-grid';
      /** Timeline clip whose analysis provides the beat grid (its beats are mapped through trim/speed). */
      clipId: string;
      /** Beat-grid artifact id (`beatGridId`) used for the snapshot. */
      artifactId: string;
      provenance: 'source' | 'processed';
    }
  | {
      kind: 'tempo-map';
    };

/** Per-member manual correction; kept on the stable member id, not on the array index. */
export interface BeatRuleMemberCorrection {
  /** Seconds added to the rule-computed start time. */
  startOffset?: number;
  /** Explicit target track replacing the rule target track for this member. */
  trackId?: string;
}

export interface BeatRuleMember {
  /** Stable member identity; survives reordering. */
  memberId: string;
  clipId: string;
  mediaFileId?: string;
  correction?: BeatRuleMemberCorrection;
}

export interface BeatDistributeRuleParams {
  /** Index of the beat that receives the first member. */
  firstBeat: number;
  /** Beats between consecutive members (>= 1). */
  beatStep: number;
  /** Seconds added to every placement. */
  offset: number;
  targetTrackId: string;
}

export type CompositionRuleStatus =
  | { state: 'ok' }
  /** Beat source changed or is no longer resolvable; stored clip projection is kept. */
  | { state: 'stale'; reason: string }
  /** Unknown operator or schema version; the rule is visible but read-only. */
  | { state: 'locked'; reason: string };

export interface BeatDistributeRule {
  id: string;
  operator: 'beat-distribute';
  schemaVersion: typeof BEAT_DISTRIBUTE_RULE_SCHEMA_VERSION;
  label: string;
  /** Ordered members; order determines beat assignment. */
  members: BeatRuleMember[];
  params: BeatDistributeRuleParams;
  source: BeatRuleSource;
  /**
   * Beat times (timeline seconds) used by the last planning. Keeps re-planning,
   * ownership checks and reload deterministic without async artifact access.
   */
  beatSnapshot: number[];
  /** Revision/fingerprint of the beat source at snapshot time (artifact id, tempo-map hash, clip timing). */
  sourceRevision: string;
  status: CompositionRuleStatus;
}

/** Rules of other operators or newer schema versions are kept verbatim and shown as locked. */
export interface UnknownCompositionRule {
  id: string;
  operator: string;
  schemaVersion: number;
  label?: string;
  [key: string]: unknown;
}

export type CompositionRule = BeatDistributeRule;

/** Composition-owned node workspace state, persisted per composition next to `sharedSceneGraphs`. */
export interface CompositionGraphState {
  version: 1;
  layout?: CompositionGraphLayout;
  /** Arrangement rules keyed by rule id. */
  rules?: Record<string, CompositionRule | UnknownCompositionRule>;
}
