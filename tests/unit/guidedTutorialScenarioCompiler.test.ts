import { describe, expect, it, vi } from 'vitest';
import {
  compileGuidedScenario,
  createGuidedScenarioSessionRequest,
  GuidedActionRuntime,
  inspectGuidedScenario,
  SemanticExecutionAdapter,
  type SemanticToolExecutor,
  type GuidedScenario,
} from '../../src/services/guidedActions';
import {
  getNextInteractiveCampaign,
  INTERACTIVE_CAMPAIGNS,
  isInteractiveCampaignId,
  PANEL_LAYOUT_TUTORIAL_ID,
  STARTUP_GUIDED_TUTORIAL_ID,
  TIMELINE_BASICS_TUTORIAL_ID,
} from '../../src/components/common/tutorial/interactiveCampaigns';

describe('guided tutorial scenario compiler', () => {
  it('compiles Workspace Basics as a calm four-panel startup tutorial', () => {
    const scenario = INTERACTIVE_CAMPAIGNS.find((campaign) => (
      campaign.id === STARTUP_GUIDED_TUTORIAL_ID
    ));

    expect(scenario).toBeDefined();
    const request = createGuidedScenarioSessionRequest(scenario!);

    expect(request.playbackMode).toBe('tutorialDemo');
    expect(request.inputLock).toEqual({ mode: 'locked', allowCancel: true });
    expect(INTERACTIVE_CAMPAIGNS).toHaveLength(3);
    expect(INTERACTIVE_CAMPAIGNS[0]?.id).toBe('workspace-basics');
    expect(scenario!.steps.map((step) => step.target)).toEqual([
      { kind: 'panel', panel: 'media' },
      { kind: 'panel', panel: 'preview' },
      { kind: 'panel', panel: 'timeline' },
      { kind: 'panel', panel: 'clip-properties' },
    ]);
    expect(request.actions.filter((action) => action.type === 'focusPanel')).toHaveLength(4);
    expect(request.actions.filter((action) => action.type === 'spotlight')).toHaveLength(4);
    expect(request.actions.filter((action) => action.type === 'callout')).toHaveLength(4);
    expect(request.actions.filter((action) => action.type === 'delay')).toHaveLength(0);
    expect(request.actions.filter((action) => action.type === 'highlightTarget')).toHaveLength(0);
    expect(request.actions.filter((action) => action.type === 'moveCursorTo')).toHaveLength(0);
    expect(request.actions.filter((action) => action.type === 'clickVisual')).toHaveLength(0);
    expect(request.actions.filter((action) => action.type === 'showInputGesture')).toHaveLength(0);
    expect(request.metadata?.presentation).toBe('panel-overview');
    expect(request.metadata?.tutorialSteps).toEqual([
      expect.objectContaining({ title: 'Media', startActionIndex: 0 }),
      expect.objectContaining({ title: 'Preview' }),
      expect.objectContaining({ title: 'Timeline' }),
      expect.objectContaining({ title: 'Properties' }),
    ]);
  });

  it('targets the real panel layout controls in the next tutorial', () => {
    const scenario = INTERACTIVE_CAMPAIGNS.find((campaign) => (
      campaign.id === PANEL_LAYOUT_TUTORIAL_ID
    ));

    expect(scenario).toBeDefined();
    const request = createGuidedScenarioSessionRequest(scenario!);

    expect(scenario!.steps.map((step) => step.target)).toEqual([
      { kind: 'panel', panel: 'clip-properties' },
      { kind: 'dom', id: 'panel-tab:clip-properties' },
      { kind: 'panel', panel: 'preview' },
      { kind: 'dom', id: 'dock-resize:any' },
      { kind: 'dom', id: 'dock-resize-corner:any' },
    ]);
    expect(scenario!.steps.map((step) => step.cursorDemo?.kind ?? null)).toEqual([
      null,
      'drag-between',
      'drag-between',
      'resize-edge',
      'corner-orbit',
    ]);
    expect(scenario!.steps.map((step) => (
      step.cursorDemo?.kind === 'drag-between'
        ? step.cursorDemo.dropPosition
        : null
    ))).toEqual([null, 'center', 'right', null, null]);
    expect(scenario!.steps.at(-1)?.cursorDemo).toEqual(expect.objectContaining({
      kind: 'corner-orbit',
      radius: 84,
    }));
    expect(request.actions.filter((action) => action.type === 'spotlight')).toHaveLength(5);
    expect(request.actions.filter((action) => action.type === 'showInputGesture')).toHaveLength(4);
    expect(request.actions.filter((action) => action.type === 'highlightTarget')).toHaveLength(0);
    expect(request.metadata?.presentation).toBe('panel-overview');
    expect(getNextInteractiveCampaign(STARTUP_GUIDED_TUTORIAL_ID)?.id).toBe(
      PANEL_LAYOUT_TUTORIAL_ID,
    );
    expect(getNextInteractiveCampaign(PANEL_LAYOUT_TUTORIAL_ID)?.id).toBe(
      TIMELINE_BASICS_TUTORIAL_ID,
    );
    expect(isInteractiveCampaignId(PANEL_LAYOUT_TUTORIAL_ID)).toBe(true);
  });

  it('chains into Timeline Basics with a temporary media workflow', () => {
    const scenario = INTERACTIVE_CAMPAIGNS.find((campaign) => (
      campaign.id === TIMELINE_BASICS_TUTORIAL_ID
    ));

    expect(scenario).toBeDefined();
    expect(scenario!.steps.map((step) => step.cursorDemo?.kind)).toEqual([
      'timeline-media-drop',
      'timeline-scrub',
      'timeline-playback',
      'timeline-clip-move',
      'timeline-clip-trim',
    ]);
    expect(scenario!.steps.map((step) => step.focusPanel)).toEqual([
      'media',
      'timeline',
      'timeline',
      'timeline',
      'timeline',
    ]);
    expect(getNextInteractiveCampaign(TIMELINE_BASICS_TUTORIAL_ID)).toBeNull();
    expect(isInteractiveCampaignId(TIMELINE_BASICS_TUTORIAL_ID)).toBe(true);
  });

  it('compiles demo scenarios into tutorial runtime requests with semantic execution', () => {
    const scenario: GuidedScenario = {
      id: 'demo-transform',
      title: 'Demo Transform',
      steps: [
        {
          id: 'move-x',
          title: 'Move clip',
          body: 'Move X position.',
          mode: 'demo',
          target: { kind: 'panel', panel: 'clip-properties' },
          toolCall: {
            tool: 'setTransform',
            args: { clipId: 'clip-1', x: 192 },
          },
        },
      ],
    };

    const request = createGuidedScenarioSessionRequest(scenario, {
      animationBudgetMs: 0,
      sessionId: 'tutorial-demo-test',
    });

    expect(request.playbackMode).toBe('tutorialDemo');
    expect(request.inputLock).toEqual({ mode: 'locked', allowCancel: true });
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'executeTool',
      tool: 'setTransform',
    }));
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'confirmState',
      check: expect.objectContaining({ kind: 'clipTransformMatches' }),
    }));
  });

  it('can execute tutorial demo semantic actions through the shared runtime adapter', async () => {
    const executor = vi.fn<SemanticToolExecutor>(async () => ({
      success: true,
      data: { tutorialEdit: true },
    }));
    const adapter = new SemanticExecutionAdapter({ executeTool: executor });
    const runtime = new GuidedActionRuntime({
      actionHandlers: adapter.createActionHandlers(),
    });
    const scenario: GuidedScenario = {
      id: 'demo-runtime-transform',
      title: 'Demo Runtime Transform',
      steps: [
        {
          id: 'move-x',
          title: 'Move clip',
          mode: 'demo',
          toolCall: {
            tool: 'setTransform',
            args: { clipId: 'clip-1', x: 192 },
          },
        },
      ],
    };
    const request = createGuidedScenarioSessionRequest(scenario, {
      animationBudgetMs: 0,
      includeValidation: false,
      sessionId: 'tutorial-demo-runtime-test',
    });

    const result = await runtime.startSession(request);

    expect(result.status).toBe('completed');
    expect(result.toolResults).toEqual([
      expect.objectContaining({ success: true, data: { tutorialEdit: true } }),
    ]);
    expect(executor).toHaveBeenCalledWith('setTransform', { clipId: 'clip-1', x: 192 }, 'internal', expect.objectContaining({
      guidedSessionId: 'tutorial-demo-runtime-test',
    }));
  });

  it('compiles guided-user scenarios into waits without semantic execution', () => {
    const scenario: GuidedScenario = {
      id: 'guided-selection',
      title: 'Guided Selection',
      defaultMode: 'guided',
      steps: [
        {
          id: 'select-any-clip',
          title: 'Select a clip',
          target: { kind: 'panel', panel: 'timeline' },
          waitFor: { kind: 'clipSelected' },
          toolCall: {
            tool: 'selectClips',
            args: { clipIds: ['clip-1'] },
          },
        },
      ],
    };

    const request = createGuidedScenarioSessionRequest(scenario);

    expect(request.playbackMode).toBe('guidedUser');
    expect(request.inputLock).toEqual({
      mode: 'targetOnly',
      targets: [{ kind: 'panel', panel: 'timeline' }],
    });
    expect(request.actions.some((action) => action.type === 'executeTool')).toBe(false);
    expect(request.actions).toContainEqual(expect.objectContaining({
      type: 'waitForUserAction',
      check: { kind: 'clipSelected' },
    }));
  });

  it('exposes compact action inspection for scenario authoring', () => {
    const scenario: GuidedScenario = {
      id: 'inspect-me',
      title: 'Inspect Me',
      steps: [
        {
          id: 'callout',
          title: 'Look here',
          target: { kind: 'panel', panel: 'timeline' },
        },
      ],
    };

    const compiled = compileGuidedScenario(scenario);
    const inspection = inspectGuidedScenario(scenario);

    expect(compiled.diagnostics.stepCount).toBe(1);
    expect(inspection).toEqual(expect.objectContaining({
      scenarioId: 'inspect-me',
      stepCount: 1,
    }));
    expect(inspection.actions.map((action) => action.type)).toContain('callout');
  });
});
