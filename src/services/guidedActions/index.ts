import { GuidedActionRuntime } from './runtime';

export * from './types';
export * from './scheduler';
export * from './targetRegistry';
export * from './runtime';
export * from './compiler';
export * from './semanticExecutionAdapter';
export * from './surfaceInteractionDriver';
export * from './choreography/timelineEditReplayDescriptors';
export * from './scenarios/recording';
export * from './scenarios/tutorialScenarioCompiler';
export * from './scenarios/validation';
export * from './targetResolvers/domTargets';

let guidedActionRuntimeInstance: GuidedActionRuntime | null = null;

if (import.meta.hot?.data?.guidedActionRuntimeInstance) {
  guidedActionRuntimeInstance = import.meta.hot.data.guidedActionRuntimeInstance as GuidedActionRuntime;
}

export function getGuidedActionRuntime(): GuidedActionRuntime {
  if (!guidedActionRuntimeInstance) {
    guidedActionRuntimeInstance = new GuidedActionRuntime();
  }
  return guidedActionRuntimeInstance;
}

export const guidedActionRuntime = getGuidedActionRuntime();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    data.guidedActionRuntimeInstance = guidedActionRuntimeInstance;
  });
}
