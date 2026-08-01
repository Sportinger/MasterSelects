import { describe, expect, it } from 'vitest';
import { createGridReplicatorContractFixture } from '../../src/services/motionDesign/replicator/contractFixtures';
import { planMotionReplicatorSemanticOperation } from '../../src/services/motionDesign/replicator/semanticOperations';

describe('MD3 semantic Replicator operations', () => {
  it('plans authorable fields with one exact revision advance', () => {
    const current = createGridReplicatorContractFixture();
    const enabled = planMotionReplicatorSemanticOperation(current, {
      type: 'set-enabled',
      expectedRevision: current.revision,
      enabled: false,
    });
    expect(enabled).toMatchObject({
      ok: true,
      operation: 'set-enabled',
      previousRevision: 3,
      nextRevision: 4,
      changed: true,
      changedPaths: ['replicator.enabled'],
      contract: { enabled: false, revision: 4 },
    });

    const layout = planMotionReplicatorSemanticOperation(current, {
      type: 'set-layout',
      expectedRevision: current.revision,
      layout: { mode: 'linear', count: 10_000, step: { x: 2, y: -1 } },
    });
    expect(layout).toMatchObject({
      ok: true,
      nextRevision: 4,
      contract: {
        revision: 4,
        layout: { mode: 'linear', count: 10_000, step: { x: 2, y: -1 } },
      },
    });

    const terminal = planMotionReplicatorSemanticOperation(current, {
      type: 'set-terminal-transform',
      expectedRevision: current.revision,
      terminalTransform: {
        mode: 'absolute',
        position: { x: 4, y: 5 },
        rotationDegrees: 30,
        scale: { x: 2, y: 0.5 },
        opacity: 0.25,
      },
    });
    expect(terminal).toMatchObject({
      ok: true,
      nextRevision: 4,
      contract: { terminalTransform: { mode: 'absolute', opacity: 0.25 } },
    });
  });

  it('sets and clears the user limit without retaining a null persistence field', () => {
    const current = createGridReplicatorContractFixture();
    const set = planMotionReplicatorSemanticOperation(current, {
      type: 'set-user-limit',
      expectedRevision: 3,
      userLimit: 10_000,
    });
    expect(set).toMatchObject({
      ok: true,
      nextRevision: 4,
      contract: { revision: 4, userLimit: 10_000 },
    });
    if (!set.ok) throw new Error('Expected successful set-user-limit plan');

    const clear = planMotionReplicatorSemanticOperation(set.contract, {
      type: 'set-user-limit',
      expectedRevision: 4,
      userLimit: null,
    });
    expect(clear).toMatchObject({ ok: true, nextRevision: 5, contract: { revision: 5 } });
    if (!clear.ok) throw new Error('Expected successful clear-user-limit plan');
    expect(clear.contract).not.toHaveProperty('userLimit');
  });

  it('returns a stable no-op without consuming a revision', () => {
    const current = createGridReplicatorContractFixture();
    const plan = planMotionReplicatorSemanticOperation(current, {
      type: 'set-enabled',
      expectedRevision: 3,
      enabled: true,
    });
    expect(plan).toMatchObject({
      ok: true,
      previousRevision: 3,
      nextRevision: 3,
      changed: false,
      changedPaths: [],
      contract: current,
    });
  });

  it('rejects stale revisions and invalid exact operation envelopes', () => {
    const current = createGridReplicatorContractFixture();
    expect(planMotionReplicatorSemanticOperation(current, {
      type: 'set-enabled',
      expectedRevision: 2,
      enabled: false,
    })).toMatchObject({
      ok: false,
      diagnostics: [{
        code: 'MOTION_REPLICATOR_OPERATION_STALE_REVISION',
        expectedRevision: 2,
        actualRevision: 3,
      }],
    });
    expect(planMotionReplicatorSemanticOperation(current, {
      type: 'set-enabled',
      expectedRevision: 3,
      enabled: false,
      layout: current.layout,
    })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_REPLICATOR_OPERATION_INVALID' }],
    });
  });

  it('rejects operation accessors without invoking their getters', () => {
    const current = createGridReplicatorContractFixture();
    let getterCalls = 0;
    const operation = {
      type: 'set-enabled',
      expectedRevision: 3,
      enabled: false,
    };
    Object.defineProperty(operation, 'enabled', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return false;
      },
    });

    expect(planMotionReplicatorSemanticOperation(current, operation)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_REPLICATOR_OPERATION_INVALID' }],
    });
    expect(getterCalls).toBe(0);
  });

  it('fails closed when a changed contract cannot advance its revision', () => {
    const current = createGridReplicatorContractFixture();
    current.revision = Number.MAX_SAFE_INTEGER;
    expect(planMotionReplicatorSemanticOperation(current, {
      type: 'set-enabled',
      expectedRevision: Number.MAX_SAFE_INTEGER,
      enabled: false,
    })).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MOTION_REPLICATOR_OPERATION_REVISION_EXHAUSTED' }],
    });
  });
});
