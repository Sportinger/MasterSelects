import { useGuidedActionStore, type GuidedActionStoreApi } from '../../stores/guidedActionStore';
import {
  guidedTargetRegistry,
  type GuidedTargetRegistry,
} from './targetRegistry';
import {
  normalizeGuidedAnimationBudget,
  planGuidedActions,
} from './scheduler';
import { createSurfaceInteractionHandlers } from './surfaceInteractionDriver';
import {
  validateGuidedCheck,
  waitForGuidedValidation,
} from './scenarios/validation';
import type {
  GuidedAction,
  GuidedActionType,
  GuidedExecutionContext,
  GuidedRuntimeEvent,
  GuidedScheduledAction,
  GuidedSerializableTargetResolution,
  GuidedSessionRequest,
  GuidedSessionResult,
  GuidedSessionSnapshot,
  GuidedSessionStatus,
  GuidedTargetRef,
  GuidedTargetResolution,
  ToolResult,
} from './types';

type StopStatus = 'cancelled' | 'skipped';
type ActiveSessionPolicy = 'reject' | 'cancel-existing';
const REDUCED_MOTION_BUDGET_MS = 250;

interface GuidedRuntimeClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface GuidedActionHandlerContext {
  session: GuidedSessionSnapshot;
  executionContext: GuidedExecutionContext;
  scheduledAction: GuidedScheduledAction;
  signal: AbortSignal;
  resolveTarget: (target: GuidedTargetRef) => Promise<GuidedTargetResolution>;
  emitEvent: (event: GuidedRuntimeEvent) => void;
}

export type GuidedActionHandler = (
  action: GuidedAction,
  context: GuidedActionHandlerContext,
) => unknown | Promise<unknown>;

export type GuidedActionHandlerMap = Partial<Record<GuidedActionType, GuidedActionHandler>>;

interface GuidedActionRuntimeOptions {
  store?: GuidedActionStoreApi;
  targetRegistry?: GuidedTargetRegistry;
  actionHandlers?: GuidedActionHandlerMap;
  activeSessionPolicy?: ActiveSessionPolicy;
  clock?: GuidedRuntimeClock;
}

interface ActiveSession {
  id: string;
  controller: AbortController;
}

class GuidedRuntimeAbortError extends Error {
  constructor() {
    super('Guided action session was stopped');
    this.name = 'GuidedRuntimeAbortError';
  }
}

export class GuidedActionRuntime {
  private store: GuidedActionStoreApi;
  private targetRegistry: GuidedTargetRegistry;
  private actionHandlers: GuidedActionHandlerMap;
  private activeSessionPolicy: ActiveSessionPolicy;
  private clock: GuidedRuntimeClock;
  private activeSession: ActiveSession | null = null;
  private stopRequests = new Map<string, { status: StopStatus; reason?: string }>();

  constructor(options: GuidedActionRuntimeOptions = {}) {
    this.store = options.store ?? useGuidedActionStore;
    this.targetRegistry = options.targetRegistry ?? guidedTargetRegistry;
    this.actionHandlers = {
      ...createSurfaceInteractionHandlers(),
      ...(options.actionHandlers ?? {}),
    };
    this.activeSessionPolicy = options.activeSessionPolicy ?? 'reject';
    this.clock = options.clock ?? {
      now: () => Date.now(),
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    };
  }

  setActionHandlers(actionHandlers: GuidedActionHandlerMap): () => void {
    const previousHandlers = this.actionHandlers;
    const nextHandlers = {
      ...this.actionHandlers,
      ...actionHandlers,
    };
    this.actionHandlers = nextHandlers;

    return () => {
      if (this.actionHandlers === nextHandlers) {
        this.actionHandlers = previousHandlers;
      }
    };
  }

  clearActionHandlers(): void {
    this.actionHandlers = {};
  }

  getActiveSessionId(): string | null {
    return this.activeSession?.id ?? null;
  }

  async startSession(request: GuidedSessionRequest): Promise<GuidedSessionResult> {
    if (this.activeSession) {
      if (this.activeSessionPolicy === 'reject') {
        return createRejectedResult(request, 'A guided action session is already running');
      }
      this.cancelSession(this.activeSession.id, 'Replaced by a newer guided action session');
      await Promise.resolve();
    }

    const sessionId = request.sessionId ?? createGuidedSessionId();
    const controller = new AbortController();
    const animationBudget = applyReducedMotionBudget(
      normalizeGuidedAnimationBudget(request.animationBudget),
    );
    const visualizationMode = animationBudget.disabled
      ? 'off'
      : request.visualizationMode ?? 'concise';
    const executionContext: GuidedExecutionContext = {
      sessionId,
      callerContext: request.callerContext,
      playbackMode: request.playbackMode ?? 'aiReplay',
      visualizationMode,
      animationBudget,
      inputLock: request.inputLock ?? { mode: 'locked', allowCancel: true },
      legacyFeedback: request.legacyFeedback ?? 'bridge',
      abortSignal: controller.signal,
    };
    const sessionActions = executionContext.visualizationMode === 'off' || animationBudget.disabled
      ? request.actions.filter(isExecutionAction)
      : request.actions;
    const plan = planGuidedActions(sessionActions, animationBudget);
    const session: GuidedSessionSnapshot = {
      id: sessionId,
      status: 'running',
      label: request.label,
      context: {
        sessionId: executionContext.sessionId,
        callerContext: executionContext.callerContext,
        playbackMode: executionContext.playbackMode,
        visualizationMode: executionContext.visualizationMode,
        animationBudget: executionContext.animationBudget,
        inputLock: executionContext.inputLock,
        legacyFeedback: executionContext.legacyFeedback,
      },
      metadata: request.metadata,
      startedAt: this.clock.now(),
      plan,
    };

    this.activeSession = { id: sessionId, controller };
    this.store.getState().startSession(session);

    const toolResults: ToolResult[] = [];
    let executedActions = 0;
    let skippedActions = 0;
    let status: GuidedSessionResult['status'] = 'completed';
    let error: string | undefined;

    try {
      for (const scheduledAction of plan.actions) {
        throwIfAborted(controller.signal);
        this.emitEvent({ type: 'step-started', sessionId, action: scheduledAction });
        this.store.getState().setCurrentStep(scheduledAction);

        const result = await this.executeScheduledAction(
          scheduledAction,
          session,
          executionContext,
        );
        if (scheduledAction.action.type === 'executeTool' && isToolResult(result)) {
          toolResults.push(result);
        }

        executedActions += 1;
        this.store.getState().completeCurrentStep();
        this.emitEvent({ type: 'step-completed', sessionId, action: scheduledAction });
      }
    } catch (caught) {
      const stopRequest = this.stopRequests.get(sessionId);
      if (caught instanceof GuidedRuntimeAbortError || controller.signal.aborted) {
        status = stopRequest?.status ?? 'cancelled';
        error = stopRequest?.reason;
        skippedActions = Math.max(0, plan.actions.length - executedActions);
      } else {
        status = 'failed';
        error = caught instanceof Error ? caught.message : 'Guided action session failed';
        skippedActions = Math.max(0, plan.actions.length - executedActions);
        this.store.getState().appendDiagnostic(sessionId, error);
      }
    } finally {
      if (this.activeSession?.id === sessionId) {
        this.activeSession = null;
      }
      this.stopRequests.delete(sessionId);
    }

    this.finishSession(sessionId, status, error);

    return {
      sessionId,
      status,
      diagnostics: plan.diagnostics,
      executedActions,
      skippedActions,
      toolResults,
      error,
    };
  }

  cancelSession(sessionId = this.activeSession?.id, reason?: string): void {
    if (!sessionId || this.activeSession?.id !== sessionId) {
      return;
    }
    this.stopRequests.set(sessionId, { status: 'cancelled', reason });
    this.store.getState().markSessionCancelling(sessionId);
    this.activeSession.controller.abort();
  }

  skipSession(sessionId = this.activeSession?.id, reason?: string): void {
    if (!sessionId || this.activeSession?.id !== sessionId) {
      return;
    }
    this.stopRequests.set(sessionId, { status: 'skipped', reason });
    this.store.getState().markSessionCancelling(sessionId);
    this.activeSession.controller.abort();
  }

  private async executeScheduledAction(
    scheduledAction: GuidedScheduledAction,
    session: GuidedSessionSnapshot,
    executionContext: GuidedExecutionContext,
  ): Promise<unknown> {
    const { action } = scheduledAction;
    const handler = this.actionHandlers[action.type];
    const context: GuidedActionHandlerContext = {
      session,
      executionContext,
      scheduledAction,
      signal: executionContext.abortSignal,
      resolveTarget: (target) => this.resolveTarget(target, executionContext),
      emitEvent: (event) => this.emitEvent(event),
    };

    if (handler) {
      const result = await handler(action, context);
      await this.waitForPlannedDuration(scheduledAction, executionContext.abortSignal);
      return result;
    }

    const result = await this.executeDefaultAction(action, scheduledAction, executionContext);
    await this.waitForPlannedDuration(scheduledAction, executionContext.abortSignal);
    return result;
  }

  private async executeDefaultAction(
    action: GuidedAction,
    scheduledAction: GuidedScheduledAction,
    context: GuidedExecutionContext,
  ): Promise<unknown> {
    switch (action.type) {
      case 'delay':
        return undefined;
      case 'resolveTarget': {
        const resolution = await this.resolveTarget(action.target, context);
        if (action.required !== false && resolution.status === 'missing') {
          throw new Error(resolution.message ?? `Missing guided target: ${resolution.reason}`);
        }
        return resolution;
      }
      case 'moveCursorTo': {
        const resolution = await this.resolveTarget(action.target, context);
        if (resolution.status === 'missing') {
          throw new Error(resolution.message ?? `Missing guided target: ${resolution.reason}`);
        }
        this.store.getState().setCursor({ visible: true, position: resolution.center });
        return resolution;
      }
      case 'dragCursor': {
        const resolution = await this.resolveTarget(action.to, context);
        if (resolution.status === 'missing') {
          throw new Error(resolution.message ?? `Missing guided target: ${resolution.reason}`);
        }
        this.store.getState().setCursor({ visible: true, position: resolution.center });
        return resolution;
      }
      case 'clickVisual':
      case 'doubleClickVisual':
        this.store.getState().setCursor({ visible: true, clicking: true });
        return undefined;
      case 'highlightTarget':
        await this.resolveTarget(action.target, context);
        this.store.getState().addHighlight({
          target: action.target,
          tone: action.tone ?? 'primary',
          durationMs: scheduledAction.plannedDurationMs,
        });
        return undefined;
      case 'spotlight':
        if (action.target) {
          await this.resolveTarget(action.target, context);
        }
        this.store.getState().setSpotlight(action.target);
        return undefined;
      case 'callout':
        if (action.target) {
          await this.resolveTarget(action.target, context);
        }
        this.store.getState().setCallout({
          title: action.title,
          body: action.body,
          target: action.target,
        });
        return undefined;
      case 'executeTool':
        throw new Error(`No semantic executor registered for guided tool "${action.tool}"`);
      case 'waitForUserAction': {
        const validation = await waitForGuidedValidation(action.check, {
          timeoutMs: action.timeoutMs ?? 10000,
          signal: context.abortSignal,
          clock: this.clock,
        });
        if (!validation.success) {
          throw new Error(validation.message ?? `Timed out waiting for guided validation: ${action.check.kind}`);
        }
        return validation;
      }
      case 'confirmState': {
        const validation = validateGuidedCheck(action.check);
        if (!validation.success) {
          throw new Error(validation.message ?? `Guided validation failed: ${action.check.kind}`);
        }
        return validation;
      }
      case 'chooseDropdownOption':
      case 'drawPreviewPath':
      case 'focusPanel':
      case 'openDropdown':
      case 'openPropertiesTab':
      case 'pressButton':
      case 'resizePanel':
      case 'scrollIntoView':
      case 'selectClip':
      case 'setPlayheadVisual':
      case 'typeInto':
        return undefined;
    }
  }

  private async resolveTarget(
    target: GuidedTargetRef,
    context: GuidedExecutionContext,
  ): Promise<GuidedTargetResolution> {
    const resolution = await this.targetRegistry.resolve(target, {
      sessionId: context.sessionId,
      signal: context.abortSignal,
      nowMs: this.clock.now(),
    });
    this.store.getState().recordTargetResolution(resolution);
    this.emitEvent({
      type: 'target-resolved',
      sessionId: context.sessionId,
      resolution: stripElementFromResolution(resolution),
    });
    if (resolution.status === 'missing') {
      this.store.getState().appendDiagnostic(context.sessionId, resolution.message ?? resolution.reason, {
        reason: resolution.reason,
      });
    }
    return resolution;
  }

  private async waitForPlannedDuration(
    scheduledAction: GuidedScheduledAction,
    signal: AbortSignal,
  ): Promise<void> {
    await this.delay(scheduledAction.plannedDurationMs, signal);
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      throwIfAborted(signal);
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new GuidedRuntimeAbortError());
        return;
      }

      const timer = this.clock.setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        this.clock.clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new GuidedRuntimeAbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private emitEvent(event: GuidedRuntimeEvent): void {
    this.store.getState().appendEvent(event);
  }

  private finishSession(
    sessionId: string,
    status: Exclude<GuidedSessionStatus, 'idle' | 'running' | 'cancelling'>,
    error?: string,
  ): void {
    this.store.getState().finishSession(sessionId, status, error);
    this.emitEvent({ type: 'session-finished', sessionId, status });
  }
}

export function createGuidedSessionId(): string {
  return `guided-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRejectedResult(
  request: GuidedSessionRequest,
  error: string,
): GuidedSessionResult {
  const plan = planGuidedActions(request.actions, request.animationBudget);
  return {
    sessionId: request.sessionId ?? 'guided-session-rejected',
    status: 'failed',
    diagnostics: plan.diagnostics,
    executedActions: 0,
    skippedActions: request.actions.length,
    toolResults: [],
    error,
  };
}

function isExecutionAction(action: GuidedAction): boolean {
  return action.type === 'executeTool' || action.type === 'confirmState' || action.type === 'waitForUserAction';
}

function stripElementFromResolution(
  resolution: GuidedTargetResolution,
): GuidedSerializableTargetResolution {
  if (resolution.status === 'missing') {
    return resolution;
  }

  return {
    status: resolution.status,
    target: resolution.target,
    rect: resolution.rect,
    point: resolution.point,
    center: resolution.center,
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GuidedRuntimeAbortError();
  }
}

function applyReducedMotionBudget(budget: ReturnType<typeof normalizeGuidedAnimationBudget>): ReturnType<typeof normalizeGuidedAnimationBudget> {
  if (budget.disabled || !prefersReducedGuidedMotion()) {
    return budget;
  }

  return {
    ...budget,
    compression: 'aggressive',
    totalMs: Math.min(budget.totalMs, REDUCED_MOTION_BUDGET_MS),
  };
}

function prefersReducedGuidedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isToolResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const maybeResult = value as Partial<ToolResult>;
  return typeof maybeResult.success === 'boolean';
}
