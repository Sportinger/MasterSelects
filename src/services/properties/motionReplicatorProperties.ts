
import type { TimelineClip } from '../../types/timeline';
import type {
  MotionLayerDefinition,
  ReplicatorDefinition,
  ReplicatorLayout,
} from '../../types/motionDesign';
import {
  createDefaultMotionLayerDefinition,
  createDefaultReplicatorDefinition,
  isMotionProperty,
} from '../../types/motionDesign';
import { normalizeMotionReplicatorBundle } from '../motionDesign/contracts/replicatorTimelineAdapter';
import {
  planMotionReplicatorSemanticOperation,
  type MotionReplicatorSemanticOperation,
} from '../motionDesign/replicator/semanticOperations';
import type { PropertyDescriptor, PropertyValueType } from '../../types/propertyRegistry';

function cloneMotion(motion: MotionLayerDefinition | undefined): MotionLayerDefinition {
  return structuredClone(motion ?? createDefaultMotionLayerDefinition('shape')) as MotionLayerDefinition;
}

function withMotion(clip: TimelineClip, updater: (motion: MotionLayerDefinition) => MotionLayerDefinition): TimelineClip {
  return {
    ...clip,
    motion: updater(cloneMotion(clip.motion)),
  };
}

function ensureReplicator(motion: MotionLayerDefinition): ReplicatorDefinition {
  return motion.replicator
    ? normalizeMotionReplicatorBundle(motion.replicator, motion.modifierStack).replicator
    : createDefaultReplicatorDefinition();
}

function createGridLayout(layout: ReplicatorLayout): Extract<ReplicatorLayout, { mode: 'grid' }> {
  if (layout.mode === 'grid') return structuredClone(layout);
  return createDefaultReplicatorDefinition().layout as Extract<ReplicatorLayout, { mode: 'grid' }>;
}

function createLinearLayout(layout: ReplicatorLayout): Extract<ReplicatorLayout, { mode: 'linear' }> {
  return layout.mode === 'linear'
    ? structuredClone(layout)
    : { mode: 'linear', count: 3, step: { x: 120, y: 0 } };
}

function createRadialLayout(layout: ReplicatorLayout): Extract<ReplicatorLayout, { mode: 'radial' }> {
  return layout.mode === 'radial'
    ? structuredClone(layout)
    : {
        mode: 'radial',
        count: 8,
        center: { x: 0, y: 0 },
        radius: 180,
        startAngleDegrees: 0,
        endAngleDegrees: 360,
        angleSampling: 'exclusive-end',
        autoOrient: false,
      };
}

function commitReplicatorOperation(
  replicator: ReplicatorDefinition,
  operation: MotionReplicatorSemanticOperation,
): ReplicatorDefinition {
  const plan = planMotionReplicatorSemanticOperation(replicator, operation);
  if (!plan.ok) {
    throw new Error(plan.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
  }
  return plan.contract;
}

export function getReplicatorDescriptorForPath(path: string, clip?: TimelineClip): PropertyDescriptor | undefined {
  if (!isMotionProperty(path) || !path.startsWith('replicator.')) return undefined;

  const defaultReplicator = createDefaultReplicatorDefinition();
  const current = clip?.motion?.replicator
    ? normalizeMotionReplicatorBundle(
        clip.motion.replicator,
        clip.motion.modifierStack,
      ).replicator
    : defaultReplicator;
  const grid = createGridLayout(current.layout);

  const specs: Record<string, {
    label: string;
    valueType: PropertyValueType;
    defaultValue: number | boolean | string;
    animatable: boolean;
    read: (replicator: ReplicatorDefinition) => number | boolean | string;
    write: (replicator: ReplicatorDefinition, value: unknown) => ReplicatorDefinition;
    ui?: PropertyDescriptor['ui'];
  }> = {
    'replicator.enabled': {
      label: 'Enabled',
      valueType: 'boolean',
      defaultValue: false,
      animatable: false,
      read: (replicator) => replicator.enabled,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-enabled',
        expectedRevision: replicator.revision,
        enabled: Boolean(value),
      }),
    },
    'replicator.layout.mode': {
      label: 'Layout',
      valueType: 'enum',
      defaultValue: 'grid',
      animatable: false,
      read: (replicator) => replicator.layout.mode,
      write: (replicator, value) => {
        const mode = String(value);
        const layout = mode === 'grid'
          ? createGridLayout(replicator.layout)
          : mode === 'linear'
            ? createLinearLayout(replicator.layout)
            : mode === 'radial'
              ? createRadialLayout(replicator.layout)
              : replicator.layout;
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout,
        });
      },
      ui: {
        options: [
          { value: 'grid', label: 'Grid' },
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Radial' },
        ],
      },
    },
    'replicator.count.x': {
      label: 'Count X',
      valueType: 'number',
      defaultValue: grid.count.columns,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.columns,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: {
            ...layout,
            count: { ...layout.count, columns: Math.max(1, Math.round(value as number)) },
          },
        });
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.count.y': {
      label: 'Count Y',
      valueType: 'number',
      defaultValue: grid.count.rows,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).count.rows,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: {
            ...layout,
            count: { ...layout.count, rows: Math.max(1, Math.round(value as number)) },
          },
        });
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.spacing.x': {
      label: 'Spacing X',
      valueType: 'number',
      defaultValue: grid.spacing.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, spacing: { ...layout.spacing, x: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.spacing.y': {
      label: 'Spacing Y',
      valueType: 'number',
      defaultValue: grid.spacing.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).spacing.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, spacing: { ...layout.spacing, y: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.patternOffset.x': {
      label: 'Pattern Offset X',
      valueType: 'number',
      defaultValue: grid.patternOffset.x,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).patternOffset.x,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: {
            ...layout,
            patternOffset: { ...layout.patternOffset, x: value as number },
          },
        });
      },
      ui: { step: 1 },
    },
    'replicator.patternOffset.y': {
      label: 'Pattern Offset Y',
      valueType: 'number',
      defaultValue: grid.patternOffset.y,
      animatable: true,
      read: (replicator) => createGridLayout(replicator.layout).patternOffset.y,
      write: (replicator, value) => {
        const layout = createGridLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: {
            ...layout,
            patternOffset: { ...layout.patternOffset, y: value as number },
          },
        });
      },
      ui: { step: 1 },
    },
    'replicator.linear.count': {
      label: 'Linear Count',
      valueType: 'number',
      defaultValue: 3,
      animatable: true,
      read: (replicator) => createLinearLayout(replicator.layout).count,
      write: (replicator, value) => {
        const layout = createLinearLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, count: Math.max(1, Math.round(value as number)) },
        });
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.linear.step.x': {
      label: 'Linear Step X',
      valueType: 'number',
      defaultValue: 120,
      animatable: true,
      read: (replicator) => createLinearLayout(replicator.layout).step.x,
      write: (replicator, value) => {
        const layout = createLinearLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, step: { ...layout.step, x: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.linear.step.y': {
      label: 'Linear Step Y',
      valueType: 'number',
      defaultValue: 0,
      animatable: true,
      read: (replicator) => createLinearLayout(replicator.layout).step.y,
      write: (replicator, value) => {
        const layout = createLinearLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, step: { ...layout.step, y: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.radial.count': {
      label: 'Radial Count',
      valueType: 'number',
      defaultValue: 8,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).count,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, count: Math.max(1, Math.round(value as number)) },
        });
      },
      ui: { min: 1, step: 1 },
    },
    'replicator.radial.center.x': {
      label: 'Radial Center X',
      valueType: 'number',
      defaultValue: 0,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).center.x,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, center: { ...layout.center, x: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.radial.center.y': {
      label: 'Radial Center Y',
      valueType: 'number',
      defaultValue: 0,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).center.y,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, center: { ...layout.center, y: value as number } },
        });
      },
      ui: { step: 1 },
    },
    'replicator.radial.radius': {
      label: 'Radial Radius',
      valueType: 'number',
      defaultValue: 180,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).radius,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, radius: Math.max(0, value as number) },
        });
      },
      ui: { min: 0, step: 1 },
    },
    'replicator.radial.startAngleDegrees': {
      label: 'Radial Start Angle',
      valueType: 'number',
      defaultValue: 0,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).startAngleDegrees,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, startAngleDegrees: value as number },
        });
      },
      ui: { unit: 'deg', step: 0.1 },
    },
    'replicator.radial.endAngleDegrees': {
      label: 'Radial End Angle',
      valueType: 'number',
      defaultValue: 360,
      animatable: true,
      read: (replicator) => createRadialLayout(replicator.layout).endAngleDegrees,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, endAngleDegrees: value as number },
        });
      },
      ui: { unit: 'deg', step: 0.1 },
    },
    'replicator.radial.angleSampling': {
      label: 'Angle Sampling',
      valueType: 'enum',
      defaultValue: 'exclusive-end',
      animatable: false,
      read: (replicator) => createRadialLayout(replicator.layout).angleSampling,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        const angleSampling = value === 'inclusive-end' ? 'inclusive-end' : 'exclusive-end';
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, angleSampling },
        });
      },
      ui: {
        options: [
          { value: 'exclusive-end', label: 'Exclusive End' },
          { value: 'inclusive-end', label: 'Inclusive End' },
        ],
      },
    },
    'replicator.radial.autoOrient': {
      label: 'Auto Orient',
      valueType: 'boolean',
      defaultValue: false,
      animatable: false,
      read: (replicator) => createRadialLayout(replicator.layout).autoOrient,
      write: (replicator, value) => {
        const layout = createRadialLayout(replicator.layout);
        return commitReplicatorOperation(replicator, {
          type: 'set-layout',
          expectedRevision: replicator.revision,
          layout: { ...layout, autoOrient: Boolean(value) },
        });
      },
    },
    'replicator.offset.mode': {
      label: 'Offset Mode',
      valueType: 'enum',
      defaultValue: 'cumulative',
      animatable: false,
      read: (replicator) => replicator.terminalTransform.mode,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          mode: value === 'absolute' ? 'absolute' : 'cumulative',
        },
      }),
      ui: {
        options: [
          { value: 'cumulative', label: 'Cumulative' },
          { value: 'absolute', label: 'Absolute' },
        ],
      },
    },
    'replicator.offset.position.x': {
      label: 'Offset X',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.position.x,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.position.x,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          position: { ...replicator.terminalTransform.position, x: value as number },
        },
      }),
      ui: { step: 1 },
    },
    'replicator.offset.position.y': {
      label: 'Offset Y',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.position.y,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.position.y,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          position: { ...replicator.terminalTransform.position, y: value as number },
        },
      }),
      ui: { step: 1 },
    },
    'replicator.offset.rotation': {
      label: 'Offset Rotation',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.rotationDegrees,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.rotationDegrees,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          rotationDegrees: value as number,
        },
      }),
      ui: { unit: 'deg', step: 0.1 },
    },
    'replicator.offset.scale.x': {
      label: 'Offset Scale X',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.scale.x,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.scale.x,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          scale: { ...replicator.terminalTransform.scale, x: value as number },
        },
      }),
      ui: { step: 0.01 },
    },
    'replicator.offset.scale.y': {
      label: 'Offset Scale Y',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.scale.y,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.scale.y,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: {
          ...replicator.terminalTransform,
          scale: { ...replicator.terminalTransform.scale, y: value as number },
        },
      }),
      ui: { step: 0.01 },
    },
    'replicator.offset.opacity': {
      label: 'Offset Opacity',
      valueType: 'number',
      defaultValue: defaultReplicator.terminalTransform.opacity,
      animatable: true,
      read: (replicator) => replicator.terminalTransform.opacity,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-terminal-transform',
        expectedRevision: replicator.revision,
        terminalTransform: { ...replicator.terminalTransform, opacity: value as number },
      }),
      ui: { min: 0, max: 1, step: 0.01 },
    },
    'replicator.userLimit': {
      label: 'Instance Limit',
      valueType: 'number',
      defaultValue: 10000,
      animatable: false,
      read: (replicator) => replicator.userLimit ?? 10000,
      write: (replicator, value) => commitReplicatorOperation(replicator, {
        type: 'set-user-limit',
        expectedRevision: replicator.revision,
        userLimit: Math.max(1, Math.round(value as number)),
      }),
      ui: { min: 1, max: 100000, step: 1 },
    },
  };

  const spec = specs[path];
  if (!spec) return undefined;

  return {
    path,
    label: spec.label,
    group: 'Motion / Replicator',
    valueType: spec.valueType,
    animatable: spec.animatable,
    defaultValue: spec.defaultValue,
    ui: { aliases: ['motion', 'replicator'], ...spec.ui },
    read: (targetClip) => spec.read(
      targetClip.motion?.replicator
        ? normalizeMotionReplicatorBundle(
            targetClip.motion.replicator,
            targetClip.motion.modifierStack,
          ).replicator
        : defaultReplicator,
    ),
    write: (targetClip, value) => withMotion(targetClip, (motion) => {
      const replicator = ensureReplicator(motion);
      return {
        ...motion,
        replicator: spec.write(replicator, value),
      };
    }),
  };
}
