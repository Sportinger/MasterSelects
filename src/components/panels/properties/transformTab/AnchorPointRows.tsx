import {
  MultiKeyframeToggle,
} from '../shared';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveResetIcon,
} from '../resolveInspector/ResolveInspectorPrimitives';
import type { CreateMidiTarget, TransformTabTransform } from './transformTabTypes';
import { LabeledValue } from './ValueControls';

interface AnchorPointRowsProps {
  clipId: string;
  createMidiTarget: CreateMidiTarget;
  isEffectively3D: boolean;
  transform: TransformTabTransform;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onChange: (property: 'anchor.x' | 'anchor.y' | 'anchor.z', value: number) => void;
  onReset: () => void;
}

function ResetAnchorButton({ onClick }: { onClick: () => void }) {
  return (
    <ResolveInspectorIconButton
      ariaLabel="Reset anchor point"
      className="resolve-inspector-reset-button"
      onClick={onClick}
      title="Reset anchor point to the source center and delete its keyframes"
    >
      <ResolveResetIcon />
    </ResolveInspectorIconButton>
  );
}

export function AnchorPointRows({
  clipId,
  createMidiTarget,
  isEffectively3D,
  transform,
  onBatchEnd,
  onBatchStart,
  onChange,
  onReset,
}: AnchorPointRowsProps) {
  const anchor = transform.anchor ?? { x: 0, y: 0, z: 0 };
  const keyframeEntries = [
    { property: 'anchor.x' as const, value: anchor.x },
    { property: 'anchor.y' as const, value: anchor.y },
    ...(isEffectively3D
      ? [{ property: 'anchor.z' as const, value: anchor.z }]
      : []),
  ];

  return (
    <ResolveInspectorRow
      actions={(
        <>
          <MultiKeyframeToggle
            clipId={clipId}
            dragId={`${clipId}:resolve-anchor-${isEffectively3D ? 'xyz' : 'xy'}`}
            entries={keyframeEntries}
            title="Add anchor point keyframes"
          />
          <ResetAnchorButton onClick={onReset} />
        </>
      )}
      label="Anchor Point"
    >
      <div className={`resolve-inspector-values resolve-inspector-values--${isEffectively3D ? 'triple' : 'pair'}`}>
        <LabeledValue
          ariaLabel="Anchor X"
          className="resolve-inspector-field"
          decimals={3}
          defaultValue={0}
          label="X"
          midiTarget={createMidiTarget('anchor.x', 'Anchor X', anchor.x, -1, 1)}
          onChange={value => onChange('anchor.x', value)}
          onDragEnd={onBatchEnd}
          onDragStart={onBatchStart}
          sensitivity={0.01}
          value={anchor.x}
        />
        {!isEffectively3D && <span aria-hidden="true" />}
        <LabeledValue
          ariaLabel="Anchor Y"
          className="resolve-inspector-field"
          decimals={3}
          defaultValue={0}
          label="Y"
          midiTarget={createMidiTarget('anchor.y', 'Anchor Y', anchor.y, -1, 1)}
          onChange={value => onChange('anchor.y', value)}
          onDragEnd={onBatchEnd}
          onDragStart={onBatchStart}
          sensitivity={0.01}
          value={anchor.y}
        />
        {isEffectively3D && (
          <LabeledValue
            ariaLabel="Anchor Z"
            className="resolve-inspector-field"
            decimals={3}
            defaultValue={0}
            label="Z"
            midiTarget={createMidiTarget('anchor.z', 'Anchor Z', anchor.z, -1, 1)}
            onChange={value => onChange('anchor.z', value)}
            onDragEnd={onBatchEnd}
            onDragStart={onBatchStart}
            sensitivity={0.01}
            value={anchor.z}
          />
        )}
      </div>
    </ResolveInspectorRow>
  );
}
