import { AI_TOOLS, executeAITool, getQuickTimelineSummary } from '../../index';
import { describeAgentControlSession, handleAgentControlRequest } from './agentControl';
import { collectDebugState } from './debugState';
import { installRealClipDragRecorder } from './debugActions/realClipDragRecorder';
import { runDebugAction } from './debugActions';
import { inspectGuidedBridgeTool, resolveBridgeToolExecution } from './guidedOptions';
import {
  isAgentTimelineLocalBenchmarkTool,
  runAgentTimelineLocalBenchmark,
} from '../../../agentTimeline/benchmark/localBenchmarkRunner/browserLocalBenchmarkRunner';
import {
  getTabPriorityDelayMs,
  registerBridgePresence,
  tabId,
  type BrowserHot,
} from './presence';

export function registerDevBridgeBrowserClient(hot: BrowserHot): void {
  const sendPresence = registerBridgePresence(
    hot,
    installRealClipDragRecorder,
    describeAgentControlSession,
  );

  hot.on('agent-control:request', async (data: {
    requestId: string;
    operation: string;
    args?: Record<string, unknown>;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      sendPresence();
      hot.send('agent-control:result', {
        requestId: data.requestId,
        result: await handleAgentControlRequest(data.operation, data.args ?? {}),
      });
    } catch (error: unknown) {
      hot.send('agent-control:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  hot.on('ai-tools:execute', async (data: {
    requestId: string;
    tool: string;
    args: Record<string, unknown>;
    options?: unknown;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      sendPresence();

      let result: unknown;
      if (data.tool === '_list') {
        result = { success: true, data: AI_TOOLS };
      } else if (data.tool === '_status') {
        result = { success: true, data: getQuickTimelineSummary() };
      } else if (data.tool === '_inspectGuided') {
        result = inspectGuidedBridgeTool(data.args);
      } else if (isAgentTimelineLocalBenchmarkTool(data.tool)) {
        result = { success: true, data: await runAgentTimelineLocalBenchmark(data.args) };
      } else {
        const execution = resolveBridgeToolExecution(data.args, data.options);
        result = await executeAITool(data.tool, execution.args, 'devBridge', execution.options);
      }

      hot.send('ai-tools:result', {
        requestId: data.requestId,
        result,
      });
    } catch (error: unknown) {
      hot.send('ai-tools:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  hot.on('debug-state:request', async (data: {
    requestId: string;
    scope?: string;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      hot.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: true, data: collectDebugState(data.scope) },
      });
    } catch (error: unknown) {
      hot.send('debug-state:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });

  hot.on('debug-action:request', async (data: {
    requestId: string;
    action: string;
    args?: Record<string, unknown>;
    targetTabId?: string | null;
  }) => {
    if (data.targetTabId && data.targetTabId !== tabId) {
      return;
    }

    try {
      const delayMs = getTabPriorityDelayMs(data.targetTabId === tabId);
      if (delayMs < 0) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      hot.send('debug-action:result', {
        requestId: data.requestId,
        result: await runDebugAction(data.action, data.args ?? {}),
      });
    } catch (error: unknown) {
      hot.send('debug-action:result', {
        requestId: data.requestId,
        result: { success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
