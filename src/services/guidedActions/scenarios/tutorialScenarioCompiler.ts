import { compileGuidedToolCall } from '../compiler';
import { stripExecutionActions } from '../choreography/toolChoreographies';
import type {
  GuidedAction,
  GuidedInputLockPolicy,
  GuidedPlaybackMode,
  GuidedSessionRequest,
  GuidedTargetRef,
  GuidedToolCall,
  GuidedVisualizationMode,
  ValidationCheck,
} from '../types';

export type GuidedScenarioStepMode = 'demo' | 'guided' | 'assist';

export interface GuidedScenarioStep {
  id: string;
  title: string;
  body?: string;
  mode?: GuidedScenarioStepMode;
  focusPanel?: Extract<GuidedTargetRef, { kind: 'panel' }>['panel'];
  showHighlight?: boolean;
  target?: GuidedTargetRef;
  inputTargets?: GuidedTargetRef[];
  actions?: GuidedAction[];
  toolCall?: GuidedToolCall;
  waitFor?: ValidationCheck;
  timeoutMs?: number;
}

export interface GuidedScenario {
  id: string;
  title: string;
  description?: string;
  defaultMode?: GuidedScenarioStepMode;
  animationBudgetMs?: number;
  visualizationMode?: GuidedVisualizationMode;
  metadata?: Record<string, unknown>;
  steps: GuidedScenarioStep[];
}

export interface GuidedScenarioCompileOptions {
  mode?: GuidedScenarioStepMode;
  includeValidation?: boolean;
}

export interface GuidedScenarioSessionOptions extends GuidedScenarioCompileOptions {
  animationBudgetMs?: number;
  sessionId?: string;
  visualizationMode?: GuidedVisualizationMode;
}

export interface GuidedCompiledScenario {
  scenario: GuidedScenario;
  actions: GuidedAction[];
  diagnostics: GuidedScenarioDiagnostics;
  stepRanges: GuidedScenarioStepRange[];
}

export interface GuidedScenarioStepRange {
  id: string;
  title: string;
  startActionIndex: number;
  endActionIndex: number;
}

export interface GuidedScenarioDiagnostics {
  actionCount: number;
  demoSteps: number;
  guidedSteps: number;
  assistSteps: number;
  stepCount: number;
  toolCallCount: number;
  waitForUserActionCount: number;
}

const DEFAULT_TUTORIAL_ANIMATION_BUDGET_MS = 3000;

export function compileGuidedScenario(
  scenario: GuidedScenario,
  options: GuidedScenarioCompileOptions = {},
): GuidedCompiledScenario {
  const compiledSteps = scenario.steps.map((step) => ({
    actions: compileGuidedScenarioStep(scenario, step, options),
    step,
  }));
  const actions = compiledSteps.flatMap((compiledStep) => compiledStep.actions);
  const modes = scenario.steps.map((step) => getStepMode(scenario, step, options));
  let nextActionIndex = 0;
  const stepRanges = compiledSteps.map(({ actions: stepActions, step }) => {
    const startActionIndex = nextActionIndex;
    nextActionIndex += stepActions.length;
    return {
      id: step.id,
      title: step.title,
      startActionIndex,
      endActionIndex: Math.max(startActionIndex, nextActionIndex - 1),
    };
  });

  return {
    scenario,
    actions,
    stepRanges,
    diagnostics: {
      actionCount: actions.length,
      assistSteps: modes.filter((mode) => mode === 'assist').length,
      demoSteps: modes.filter((mode) => mode === 'demo').length,
      guidedSteps: modes.filter((mode) => mode === 'guided').length,
      stepCount: scenario.steps.length,
      toolCallCount: scenario.steps.filter((step) => Boolean(step.toolCall)).length,
      waitForUserActionCount: actions.filter((action) => action.type === 'waitForUserAction').length,
    },
  };
}

export function createGuidedScenarioSessionRequest(
  scenario: GuidedScenario,
  options: GuidedScenarioSessionOptions = {},
): GuidedSessionRequest {
  const compiled = compileGuidedScenario(scenario, options);

  return {
    actions: compiled.actions,
    animationBudget: options.animationBudgetMs ?? scenario.animationBudgetMs ?? DEFAULT_TUTORIAL_ANIMATION_BUDGET_MS,
    callerContext: 'internal',
    inputLock: createScenarioInputLock(scenario, options),
    label: `Tutorial: ${scenario.title}`,
    metadata: {
      ...scenario.metadata,
      diagnostics: compiled.diagnostics,
      scenarioId: scenario.id,
      tutorialSteps: compiled.stepRanges,
    },
    playbackMode: getScenarioPlaybackMode(scenario, options),
    sessionId: options.sessionId,
    visualizationMode: options.visualizationMode ?? scenario.visualizationMode ?? 'concise',
  };
}

function compileGuidedScenarioStep(
  scenario: GuidedScenario,
  step: GuidedScenarioStep,
  options: GuidedScenarioCompileOptions,
): GuidedAction[] {
  const mode = getStepMode(scenario, step, options);
  const actions: GuidedAction[] = [];
  const panelToFocus = step.focusPanel ?? (step.target?.kind === 'panel' ? step.target.panel : null);

  if (panelToFocus) {
    actions.push({
      type: 'focusPanel',
      panel: panelToFocus,
      family: 'context',
      label: `Open ${panelToFocus}`,
    });
  }

  if (step.target) {
    actions.push(
      { type: 'resolveTarget', target: step.target, required: false, family: 'context' },
      { type: 'spotlight', target: step.target, family: 'context' },
    );
    if (step.showHighlight !== false) {
      actions.push({
        type: 'highlightTarget',
        target: step.target,
        tone: 'primary',
        durationMs: 500,
        family: 'context',
      });
    }
  }

  actions.push({
    type: 'callout',
    title: step.title,
    body: step.body,
    target: step.target,
    family: mode === 'guided' ? 'validation' : 'context',
    label: step.id,
  });

  if (step.actions) {
    actions.push(...(mode === 'guided' ? stripExecutionActions(step.actions) : step.actions));
  }

  if (step.toolCall) {
    const compiledToolCall = compileGuidedToolCall(step.toolCall, {
      includeValidation: options.includeValidation ?? mode !== 'guided',
    });
    actions.push(...(mode === 'guided'
      ? stripExecutionActions(compiledToolCall.actions)
      : compiledToolCall.actions));
  }

  if (step.waitFor) {
    if (mode === 'guided') {
      actions.push({
        type: 'waitForUserAction',
        check: step.waitFor,
        timeoutMs: step.timeoutMs,
        family: 'validation',
        label: `Validate ${step.id}`,
      });
    } else {
      actions.push({
        type: 'confirmState',
        check: step.waitFor,
        family: 'validation',
        label: `Validate ${step.id}`,
      });
    }
  }

  return actions;
}

function createScenarioInputLock(
  scenario: GuidedScenario,
  options: GuidedScenarioCompileOptions,
): GuidedInputLockPolicy {
  const modes = scenario.steps.map((step) => getStepMode(scenario, step, options));
  const hasGuidedStep = modes.includes('guided');
  if (!hasGuidedStep) {
    return { mode: 'locked', allowCancel: true };
  }

  const targets = scenario.steps.flatMap((step) => {
    const mode = getStepMode(scenario, step, options);
    if (mode !== 'guided') {
      return [];
    }
    return step.inputTargets ?? (step.target ? [step.target] : []);
  });

  return targets.length > 0
    ? { mode: 'targetOnly', targets }
    : { mode: 'passthrough' };
}

function getScenarioPlaybackMode(
  scenario: GuidedScenario,
  options: GuidedScenarioCompileOptions,
): GuidedPlaybackMode {
  const modes = scenario.steps.map((step) => getStepMode(scenario, step, options));
  if (modes.includes('assist')) {
    return 'assist';
  }
  if (modes.includes('guided')) {
    return 'guidedUser';
  }
  return 'tutorialDemo';
}

function getStepMode(
  scenario: GuidedScenario,
  step: GuidedScenarioStep,
  options: GuidedScenarioCompileOptions,
): GuidedScenarioStepMode {
  return step.mode ?? options.mode ?? scenario.defaultMode ?? 'demo';
}
