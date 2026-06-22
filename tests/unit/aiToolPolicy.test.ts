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
      'simulateFrameKeypresses', 'simulateScrub', 'simulatePlayback', 'simulatePlaybackPath', 'captureFrame', 'getKeyframes', 'getMarkers', 'getMasks',
    ];
    for (const name of readOnlyTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(policy!.readOnly, `${name} should be readOnly`).toBe(true);
    }
  });

  it('sensitive tools have sensitiveDataAccess=true', () => {
    const sensitiveTools = ['getStats', 'getStatsHistory', 'getLogs', 'getRuntimeDiagnostics', 'getPlaybackTrace'];
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

  it('importLocalFiles allows devBridge and still requires confirmation', () => {
    const policy = getToolPolicy('importLocalFiles');
    expect(policy).toBeDefined();
    expect(policy!.requiresConfirmation).toBe(true);
    expect(policy!.allowedCallers.includes('devBridge')).toBe(true);
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
    const bridgeTelemetryTools = ['getStats', 'getStatsHistory', 'getRuntimeDiagnostics', 'getPlaybackTrace'];
    for (const name of bridgeTelemetryTools) {
      const result = checkToolAccess(name, 'devBridge');
      expect(result.allowed, `devBridge should be able to access ${name}`).toBe(true);
    }
  });

  it('devBridge can access playback simulation tools', () => {
    for (const tool of ['simulateFrameKeypresses', 'simulateScrub', 'simulatePlayback', 'simulatePlaybackPath']) {
      const result = checkToolAccess(tool, 'devBridge');
      expect(result.allowed, `${tool} should be allowed for devBridge`).toBe(true);
    }
  });

  it('devBridge can access runtime logs and diagnostics', () => {
    for (const tool of ['getLogs', 'getRuntimeDiagnostics', 'clearRuntimeDiagnostics']) {
      const result = checkToolAccess(tool, 'devBridge');
      expect(result.allowed, `${tool} should be allowed for devBridge`).toBe(true);
    }
  });

  it('pixel particle QA runner is limited to dev/test callers', () => {
    const policy = getToolPolicy('runPixelParticleDisintegrateQa');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runPixelParticleDisintegrateQa', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runPixelParticleDisintegrateQa', 'console').allowed).toBe(true);
    expect(checkToolAccess('runPixelParticleDisintegrateQa', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runPixelParticleDisintegrateQa', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runPixelParticleDisintegrateQa', 'nativeHelper').allowed).toBe(false);
  });

  it('render host mode control is limited to dev/test callers', () => {
    const policy = getToolPolicy('setRenderHostMode');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('low');
    expect(checkToolAccess('setRenderHostMode', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('setRenderHostMode', 'console').allowed).toBe(true);
    expect(checkToolAccess('setRenderHostMode', 'internal').allowed).toBe(true);
    expect(checkToolAccess('setRenderHostMode', 'chat').allowed).toBe(false);
    expect(checkToolAccess('setRenderHostMode', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first capability probe is devBridge-only telemetry mutation', () => {
    const policy = getToolPolicy('runWorkerFirstRenderCapabilityProbe');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('low');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstRenderCapabilityProbe', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRenderCapabilityProbe', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRenderCapabilityProbe', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRenderCapabilityProbe', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRenderCapabilityProbe', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first solid/text/image fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstSolidTextImageGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstSolidTextImageGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstSolidTextImageGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first multi-video fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstMultiVideoGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiVideoGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiVideoGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiVideoGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiVideoGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiVideoGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first webcodecs-provider fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstWebCodecsProviderGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstWebCodecsProviderGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstWebCodecsProviderGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstWebCodecsProviderGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstWebCodecsProviderGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstWebCodecsProviderGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first html-provider fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstHtmlProviderGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstHtmlProviderGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstHtmlProviderGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstHtmlProviderGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstHtmlProviderGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstHtmlProviderGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first jpeg-proxy fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstJpegProxyGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstJpegProxyGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstJpegProxyGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first multi-target/output-slice fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstMultiTargetOutputSliceGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first ram-cache fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstRamCacheGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRamCacheGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRamCacheGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first bake fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstBakeGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstBakeGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstBakeGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first export fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstExportGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstExportGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstExportGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first universal 3D/Gaussian/CAD fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstUniversal3dGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstUniversal3dGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstUniversal3dGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first effects/masks/transitions fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstEffectsMasksTransitionsGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first effects/masks/transitions shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstEffectsMasksTransitionsShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstEffectsMasksTransitionsShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first nested-comps fixture runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstNestedCompsGoldenFixture');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsGoldenFixture', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstNestedCompsGoldenFixture', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstNestedCompsGoldenFixture', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsGoldenFixture', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsGoldenFixture', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first nested-comps shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstNestedCompsShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstNestedCompsShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstNestedCompsShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstNestedCompsShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first ram-cache shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstRamCacheShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRamCacheShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRamCacheShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRamCacheShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first bake shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstBakeShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstBakeShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstBakeShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstBakeShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first export shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstExportShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstExportShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstExportShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstExportShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first universal 3D/Gaussian/CAD shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstUniversal3dShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstUniversal3dShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstUniversal3dShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstUniversal3dShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first solid/text/image shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstSolidTextImageShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstSolidTextImageShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstSolidTextImageShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstSolidTextImageShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first multi-target/output-slice shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstMultiTargetOutputSliceShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstMultiTargetOutputSliceShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first jpeg-proxy shadow parity runner is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstJpegProxyShadowParity');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyShadowParity', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstJpegProxyShadowParity', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstJpegProxyShadowParity', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyShadowParity', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstJpegProxyShadowParity', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first W5 evidence suite is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstW5EvidenceSuite');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstW5EvidenceSuite', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstW5EvidenceSuite', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstW5EvidenceSuite', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstW5EvidenceSuite', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstW5EvidenceSuite', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first platform evidence package is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstPlatformEvidencePackage');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstPlatformEvidencePackage', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstPlatformEvidencePackage', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstPlatformEvidencePackage', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstPlatformEvidencePackage', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstPlatformEvidencePackage', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first platform evidence matrix verifier is read-only devBridge automation', () => {
    const policy = getToolPolicy('verifyWorkerFirstPlatformEvidenceMatrix');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(true);
    expect(policy!.riskLevel).toBe('low');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('verifyWorkerFirstPlatformEvidenceMatrix', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('verifyWorkerFirstPlatformEvidenceMatrix', 'internal').allowed).toBe(true);
    expect(checkToolAccess('verifyWorkerFirstPlatformEvidenceMatrix', 'chat').allowed).toBe(false);
    expect(checkToolAccess('verifyWorkerFirstPlatformEvidenceMatrix', 'console').allowed).toBe(false);
    expect(checkToolAccess('verifyWorkerFirstPlatformEvidenceMatrix', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first runtime export/playback smoke is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstRuntimeExportPlaybackSmoke');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstRuntimeExportPlaybackSmoke', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRuntimeExportPlaybackSmoke', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRuntimeExportPlaybackSmoke', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRuntimeExportPlaybackSmoke', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRuntimeExportPlaybackSmoke', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first real-video runtime smoke is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstRealVideoRuntimeSmoke');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstRealVideoRuntimeSmoke', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRealVideoRuntimeSmoke', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstRealVideoRuntimeSmoke', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRealVideoRuntimeSmoke', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstRealVideoRuntimeSmoke', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first golden fixture capture is controlled devBridge automation', () => {
    const policy = getToolPolicy('captureWorkerFirstGoldenFixtureFingerprint');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('captureWorkerFirstGoldenFixtureFingerprint', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('captureWorkerFirstGoldenFixtureFingerprint', 'internal').allowed).toBe(true);
    expect(checkToolAccess('captureWorkerFirstGoldenFixtureFingerprint', 'chat').allowed).toBe(false);
    expect(checkToolAccess('captureWorkerFirstGoldenFixtureFingerprint', 'console').allowed).toBe(false);
    expect(checkToolAccess('captureWorkerFirstGoldenFixtureFingerprint', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first proof capture is a low-risk telemetry mutation', () => {
    const policy = getToolPolicy('captureWorkerFirstVisiblePresentationProof');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('low');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('captureWorkerFirstVisiblePresentationProof', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('captureWorkerFirstVisiblePresentationProof', 'internal').allowed).toBe(true);
    expect(checkToolAccess('captureWorkerFirstVisiblePresentationProof', 'chat').allowed).toBe(false);
    expect(checkToolAccess('captureWorkerFirstVisiblePresentationProof', 'console').allowed).toBe(false);
    expect(checkToolAccess('captureWorkerFirstVisiblePresentationProof', 'nativeHelper').allowed).toBe(false);
  });

  it('worker-first stress proof capture is controlled devBridge automation', () => {
    const policy = getToolPolicy('runWorkerFirstVisiblePresentationStressProof');
    expect(policy).toBeDefined();
    expect(policy!.readOnly).toBe(false);
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresConfirmation).toBe(false);
    expect(checkToolAccess('runWorkerFirstVisiblePresentationStressProof', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstVisiblePresentationStressProof', 'internal').allowed).toBe(true);
    expect(checkToolAccess('runWorkerFirstVisiblePresentationStressProof', 'chat').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstVisiblePresentationStressProof', 'console').allowed).toBe(false);
    expect(checkToolAccess('runWorkerFirstVisiblePresentationStressProof', 'nativeHelper').allowed).toBe(false);
  });

  it('timeline canvas verification smokes are devBridge-only automation tools', () => {
    for (const tool of [
      'runTimelineCanvasBladeToolSmoke',
      'runTimelineCanvasExportPreviewParitySmoke',
      'runTimelineCanvasLargeProjectSmoke',
      'runTimelineCanvasMarqueeSmoke',
      'runTimelineCanvasPlayheadSmoothnessSmoke',
      'runTimelineCanvasThumbnailReloadSmoke',
      'runTimelineCanvasRamPreviewSmoke',
      'runTimelineCanvasSpectralPlaybackSmoke',
    ]) {
      const policy = getToolPolicy(tool);
      expect(policy, `Missing policy for ${tool}`).toBeDefined();
      expect(policy!.readOnly).toBe(false);
      expect(policy!.riskLevel).toBe('medium');
      expect(checkToolAccess(tool, 'devBridge').allowed, `${tool} should allow devBridge`).toBe(true);
      expect(checkToolAccess(tool, 'console').allowed, `${tool} should allow console`).toBe(true);
      expect(checkToolAccess(tool, 'internal').allowed, `${tool} should allow internal`).toBe(true);
      expect(checkToolAccess(tool, 'chat').allowed, `${tool} should not allow chat`).toBe(false);
      expect(checkToolAccess(tool, 'nativeHelper').allowed, `${tool} should not allow nativeHelper`).toBe(false);
    }
  });

  it('sensitive telemetry tools still exclude nativeHelper', () => {
    const helperBlockedTools = ['getLogs', 'getRuntimeDiagnostics', 'clearRuntimeDiagnostics', 'getStats', 'getStatsHistory', 'getPlaybackTrace'];
    for (const name of helperBlockedTools) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(
        policy!.allowedCallers.includes('nativeHelper'),
        `${name} should not allow nativeHelper`
      ).toBe(false);
    }
  });

  it('local file tools allow devBridge and nativeHelper', () => {
    for (const name of ['listLocalFiles', 'importLocalFiles']) {
      const policy = getToolPolicy(name);
      expect(policy, `Missing policy for ${name}`).toBeDefined();
      expect(policy!.allowedCallers.includes('devBridge'), `${name} should allow devBridge`).toBe(true);
      expect(policy!.allowedCallers.includes('nativeHelper'), `${name} should allow nativeHelper`).toBe(true);
    }
  });

  it('every defined tool allows at least one caller', () => {
    const callers = ['chat', 'devBridge', 'nativeHelper', 'console', 'internal'] as const;
    for (const name of definedToolNames) {
      const hasAllowedCaller = callers.some(caller => checkToolAccess(name, caller).allowed);
      expect(hasAllowedCaller, `${name} should allow at least one caller`).toBe(true);
    }
  });
});
