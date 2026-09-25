// Shared by the main-thread fold sequencer and the canvas worker: a group builds
// node by node from left to right, and the next group waits until it is done.
export const NODE_ENTER_MS = 330;
const NODE_APPEAR_STEP_MS = 5;
const MAX_BUILD_MS = 700;
// The next group starts while this wave's last node is still fading in, so the
// build reads as one continuous left-to-right wave without idle gaps.
const HANDOFF_MS = NODE_ENTER_MS * 0.25;

/** Delay between two consecutive nodes of one build-up wave. */
export function buildUpStagger(added: number): number {
  return added > 1 ? Math.min(NODE_APPEAR_STEP_MS, (MAX_BUILD_MS - NODE_ENTER_MS) / (added - 1)) : 0;
}

/** Time until the next group may start its wave. */
export function buildUpDuration(added: number): number {
  return added > 0 ? buildUpStagger(added) * (added - 1) + HANDOFF_MS : 0;
}
