// Arbitrates which overlay may draw into the shared goo canvas. The dock
// drag overlay and the global touch feedback layer reuse one WebGL context
// (iOS caps live contexts), so exactly one of them renders at a time: the
// dock drag force-claims the stage for its whole run (drag + settle), the
// touch layer only draws while the stage is free and re-claims it on the
// next frame after release.

export type GooStageOwner = 'dock' | 'touch';

let owner: GooStageOwner | null = null;

export const claimGooStage = (who: GooStageOwner): void => {
  owner = who;
};

export const releaseGooStage = (who: GooStageOwner): void => {
  if (owner === who) {
    owner = null;
  }
};

export const getGooStageOwner = (): GooStageOwner | null => owner;
