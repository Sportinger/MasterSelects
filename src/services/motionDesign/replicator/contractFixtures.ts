import {
  MOTION_REPLICATOR_CONTRACT_ID,
  MOTION_REPLICATOR_CONTRACT_VERSION,
  type LegacyMotionReplicatorDefinition,
  type MotionReplicatorContractV2,
  type ReplicatorBounds,
  type ReplicatorRuntimeLimits,
  type ReplicatorTerminalTransform,
} from './contracts';

export function createIdentityReplicatorTerminalTransform(): ReplicatorTerminalTransform {
  return {
    mode: 'cumulative',
    position: { x: 0, y: 0 },
    rotationDegrees: 0,
    scale: { x: 1, y: 1 },
    opacity: 1,
  };
}

export function createReplicatorUnitSourceBounds(): ReplicatorBounds {
  return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
}

export function createReplicatorReferenceRuntimeLimits(): ReplicatorRuntimeLimits {
  return {
    deviceMaxInstances: 10_000,
    renderTargetMaxInstances: 10_000,
  };
}

export function createGridReplicatorContractFixture(): MotionReplicatorContractV2 {
  return {
    contract: MOTION_REPLICATOR_CONTRACT_ID,
    version: MOTION_REPLICATOR_CONTRACT_VERSION,
    enabled: true,
    revision: 3,
    layout: {
      mode: 'grid',
      count: { columns: 3, rows: 2 },
      spacing: { x: 10, y: 20 },
      patternOffset: { x: 3, y: -2 },
    },
    terminalTransform: createIdentityReplicatorTerminalTransform(),
  };
}

export function createLinearReplicatorContractFixture(): MotionReplicatorContractV2 {
  return {
    contract: MOTION_REPLICATOR_CONTRACT_ID,
    version: MOTION_REPLICATOR_CONTRACT_VERSION,
    enabled: true,
    revision: 4,
    layout: {
      mode: 'linear',
      count: 3,
      step: { x: 10, y: -5 },
    },
    terminalTransform: {
      mode: 'cumulative',
      position: { x: 20, y: 10 },
      rotationDegrees: 90,
      scale: { x: 2, y: 0.5 },
      opacity: 0.25,
    },
  };
}

export function createRadialReplicatorContractFixture(): MotionReplicatorContractV2 {
  return {
    contract: MOTION_REPLICATOR_CONTRACT_ID,
    version: MOTION_REPLICATOR_CONTRACT_VERSION,
    enabled: true,
    revision: 5,
    layout: {
      mode: 'radial',
      count: 3,
      center: { x: 5, y: -5 },
      radius: 10,
      startAngleDegrees: 0,
      endAngleDegrees: 180,
      angleSampling: 'inclusive-end',
      autoOrient: true,
    },
    terminalTransform: createIdentityReplicatorTerminalTransform(),
  };
}

export function createFortyByTwentyFiveGridContractFixture(): MotionReplicatorContractV2 {
  const fixture = createGridReplicatorContractFixture();
  fixture.revision = 40_025;
  fixture.layout = {
    mode: 'grid',
    count: { columns: 40, rows: 25 },
    spacing: { x: 8, y: 8 },
    patternOffset: { x: 4, y: 0 },
  };
  return fixture;
}

export function createTwentyThousandLinearContractFixture(): MotionReplicatorContractV2 {
  const fixture = createLinearReplicatorContractFixture();
  fixture.revision = 20_000;
  fixture.layout = {
    mode: 'linear',
    count: 20_000,
    step: { x: 1, y: 0 },
  };
  fixture.terminalTransform = createIdentityReplicatorTerminalTransform();
  return fixture;
}

export function createLegacyReplicatorContractFixture(
  maxInstances?: number,
): LegacyMotionReplicatorDefinition {
  return {
    enabled: true,
    layout: {
      mode: 'grid',
      count: { x: 3, y: 2 },
      spacing: { x: 10, y: 20 },
      patternOffset: { x: 3, y: -2 },
    },
    offset: {
      mode: 'cumulative',
      position: { x: 12, y: -4 },
      rotation: 45,
      scale: { x: 1.5, y: 0.75 },
      opacity: 0.6,
    },
    modifiers: [],
    ...(maxInstances === undefined ? {} : { maxInstances }),
  };
}
