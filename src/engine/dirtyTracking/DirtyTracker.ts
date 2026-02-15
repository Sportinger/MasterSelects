// DirtyTracker — compares SceneGraph versions between frames.
// For clean (unchanged) nodes, returns the previous EvaluatedNode result
// instead of re-running keyframe interpolation.

import type { SceneGraph, SceneNode, EvaluatedNode } from '../sceneGraph/types.ts';
import type { TrackedNodeState, DirtyFlags, DirtyTrackingStats } from './types.ts';

export class DirtyTracker {
  private tracked = new Map<string, TrackedNodeState>();
  private prevEvaluations = new Map<string, EvaluatedNode>();

  /**
   * Update dirty state for all nodes in the graph.
   * Call this once per frame before evaluation.
   *
   * IMPORTANT: Do NOT update version fields here — they must remain at the
   * values from the last successful evaluation so that computeFlags() can
   * detect changes. Versions are updated in cacheEvaluation() instead.
   */
  update(graph: SceneGraph, _time: number): void {
    for (const [nodeId] of graph.nodeById) {
      const state = this.tracked.get(nodeId);

      if (!state) {
        // New node — create with mismatched versions to force dirty.
        // lastEvaluation: null also guarantees getOrReuse() returns null.
        this.tracked.set(nodeId, {
          nodeId,
          version: -1,
          transformVersion: -1,
          effectsVersion: -1,
          structureVersion: -1,
          lastTime: -1,
          lastEvaluation: null,
        });
        continue;
      }

      // Don't update versions or lastTime here — leave them at the values
      // from the last cacheEvaluation() call so dirty detection works.
    }

    // Remove tracked nodes that no longer exist in the graph
    for (const nodeId of this.tracked.keys()) {
      if (!graph.nodeById.has(nodeId)) {
        this.tracked.delete(nodeId);
        this.prevEvaluations.delete(nodeId);
      }
    }

  }

  /**
   * Get a cached evaluation for a node, or null if the node is dirty.
   * Video nodes are always dirty when time changes (new frame needed).
   * Image/text/solid nodes are only dirty when their versions change.
   */
  getOrReuse(node: SceneNode, currentTime: number): EvaluatedNode | null {
    const state = this.tracked.get(node.id);
    if (!state || !state.lastEvaluation) return null;

    const flags = this.computeFlags(node, state, currentTime);

    // If any flag is dirty, must re-evaluate
    if (flags.transform || flags.effects || flags.source || flags.structure || flags.time) {
      return null;
    }

    return state.lastEvaluation;
  }

  /**
   * Store the evaluation result for a node (called after evaluating).
   * Also updates version fields so the NEXT frame's dirty check can detect changes.
   */
  cacheEvaluation(nodeId: string, evaluation: EvaluatedNode, currentTime: number): void {
    const state = this.tracked.get(nodeId);
    if (state) {
      state.lastEvaluation = evaluation;
      // Update versions NOW (after evaluation) so next frame's computeFlags()
      // compares the new node versions against these cached versions.
      const node = evaluation.sceneNode;
      state.version = node.version;
      state.transformVersion = node.transformVersion;
      state.effectsVersion = node.effectsVersion;
      state.structureVersion = node.structureVersion;
      state.lastTime = currentTime;
    }
    this.prevEvaluations.set(nodeId, evaluation);
  }

  /**
   * Get statistics about dirty tracking effectiveness.
   */
  getStats(): DirtyTrackingStats {
    let total = 0;
    let dirty = 0;
    let clean = 0;

    for (const state of this.tracked.values()) {
      total++;
      if (state.lastEvaluation) {
        clean++;
      } else {
        dirty++;
      }
    }

    return {
      totalNodes: total,
      dirtyNodes: dirty,
      cleanNodes: clean,
      skipRate: total > 0 ? clean / total : 0,
      interpolationsSaved: clean * 9, // 9 interpolations per clean node (transform properties)
    };
  }

  /**
   * Clear all tracking state.
   */
  clear(): void {
    this.tracked.clear();
    this.prevEvaluations.clear();
  }

  // === Private ===

  private computeFlags(
    node: SceneNode,
    state: TrackedNodeState,
    currentTime: number
  ): DirtyFlags {
    const timeChanged = Math.abs(currentTime - state.lastTime) > 0.0001;

    // Video nodes always need re-evaluation when time changes (new decoded frame)
    const isVideoNode = node.type === 'video';

    return {
      transform: node.transformVersion !== state.transformVersion,
      effects: node.effectsVersion !== state.effectsVersion,
      source: isVideoNode && timeChanged,
      structure: node.structureVersion !== state.structureVersion,
      time: timeChanged && node.hasKeyframes,
      any: false, // computed below
    };
  }
}
