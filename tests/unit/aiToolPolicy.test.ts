import { describe, it, expect } from 'vitest';
import { getToolPolicy, checkToolAccess } from '../../src/services/aiTools/policy';
import { AI_TOOLS } from '../../src/services/aiTools/definitions/index';
import { MODIFYING_TOOLS } from '../../src/services/aiTools/types';

describe('AI Tool Policy Registry', () => {
  // Get all tool names from the definitions
  const definedToolNames = AI_TOOLS.map(t => t.function.name);

  it('every tool in AI_TOOLS has a policy entry', () => {
    for (const name of definedToolNames) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for tool: ${name}`).toBeDefined();
    }
  });

  it('MODIFYING_TOOLS entries are all readOnly=false in policy', () => {
    for (const toolName of MODIFYING_TOOLS) {
      const policy = getToolPolicy(toolName);
      if (policy) {
        expect(policy.readOnly, `${toolName} should not be readOnly`).toBe(false);
      }
    }
  });

  it('checkToolAccess returns allowed=true for deleteClip from devBridge', () => {
    const result = checkToolAccess('deleteClip', 'devBridge');
    expect(result.allowed).toBe(true);
  });

  it('checkToolAccess returns allowed=true for getTimelineState from devBridge', () => {
    const result = checkToolAccess('getTimelineState', 'devBridge');
    expect(result.allowed).toBe(true);
  });

  it('unknown tool returns allowed=false', () => {
    const result = checkToolAccess('nonExistentTool', 'chat');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown tool');
  });

  it('executeBatch is riskLevel high', () => {
    const policy = getToolPolicy('executeBatch');
    expect(policy).toBeDefined();
    expect(policy!.riskLevel).toBe('high');
  });

  it('executeBatch requires confirmation', () => {
    const policy = getToolPolicy('executeBatch');
    expect(policy).toBeDefined();
    expect(policy!.requiresConfirmation).toBe(true);
  });

  it('read-only tools are marked readOnly=true', () => {
    const readOnlyTools = [
      'getTimelineState', 'getClipDetails', 'getClipsInTimeRange',
      'getMediaItems', 'play', 'pause', 'undo', 'redo',
      'reloadApp', 'simulateScrub', 'simulatePlayback', 'simulatePlaybackPath', 'captureFrame', 'getKeyframes', 'getMarkers', 'getMasks',
    ];
    for (const name of readOnlyTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(policy!.readOnly, `${name} should be readOnly`).toBe(true);
    }
  });

  it('sensitive tools have sensitiveDataAccess=true', () => {
    const sensitiveTools = ['getStats', 'getStatsHistory', 'getLogs', 'getPlaybackTrace'];
    for (const name of sensitiveTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(policy!.sensitiveDataAccess, `${name} should have sensitiveDataAccess`).toBe(true);
    }
  });

  it('local file tools have localFileAccess=true', () => {
    const fileTools = ['listLocalFiles', 'importLocalFiles'];
    for (const name of fileTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(policy!.localFileAccess, `${name} should have localFileAccess`).toBe(true);
    }
  });

  it('high-risk mutating tools allow devBridge but still require confirmation', () => {
    const highRiskTools = [
      'deleteClip', 'deleteClips', 'deleteTrack', 'deleteMediaItem',
      'cutRangesFromClip', 'executeBatch', 'downloadAndImportVideo',
    ];
    for (const name of highRiskTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(
        policy!.allowedCallers.includes('devBridge'),
        `${name} should allow devBridge`
      ).toBe(true);
      expect(policy!.requiresConfirmation, `${name} should require confirmation`).toBe(true);
    }
  });

  it('importLocalFiles excludes devBridge even though it is high risk', () => {
    const policy = getToolPolicy('importLocalFiles');
    expect(policy).toBeDefined();
    expect(policy!.requiresConfirmation).toBe(true);
    expect(policy!.allowedCallers.includes('devBridge')).toBe(false);
  });

  it('mutating editor tools allow nativeHelper', () => {
    const helperAllowedTools = [
      'deleteClip',
      'executeBatch',
      'splitClipEvenly',
      'reorderClips',
      'moveClip',
      'trimClip',
    ];
    for (const name of helperAllowedTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(
        policy!.allowedCallers.includes('nativeHelper'),
        `${name} should allow nativeHelper`
      ).toBe(true);
    }
  });

  it('devBridge can access live telemetry tools', () => {
    const bridgeTelemetryTools = ['getStats', 'getStatsHistory', 'getPlaybackTrace'];
    for (const name of bridgeTelemetryTools) {
      const result = checkToolAccess(name, 'devBridge');
      expect(result.allowed, `devBridge should be able to access ${name}`).toBe(true);
    }
  });

  it('devBridge can access playback simulation tools', () => {
    for (const tool of ['reloadApp', 'simulateScrub', 'simulatePlayback', 'simulatePlaybackPath']) {
      const result = checkToolAccess(tool, 'devBridge');
      expect(result.allowed, `${tool} should be allowed for devBridge`).toBe(true);
    }
  });

  it('devBridge can access getLogs', () => {
    const result = checkToolAccess('getLogs', 'devBridge');
    expect(result.allowed).toBe(true);
  });

  it('sensitive and local file tools still exclude nativeHelper', () => {
    const helperBlockedTools = ['getLogs', 'getStats', 'getStatsHistory', 'getPlaybackTrace', 'importLocalFiles'];
    for (const name of helperBlockedTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(
        policy!.allowedCallers.includes('nativeHelper'),
        `${name} should not allow nativeHelper`
      ).toBe(false);
    }
  });

  it('chat caller can access all tools that have a policy', () => {
    for (const name of definedToolNames) {
      const result = checkToolAccess(name, 'chat');
      expect(result.allowed, `chat should be able to access ${name}`).toBe(true);
    }
  });
});
