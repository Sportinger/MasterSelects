import type { NodeGraphPortMetadata } from '../../types/nodeGraph';
import type { NodePortContract } from '../../types/nodePortContract';
import { OPERATOR_SIGNAL_CONTRACTS, signalFormatLabel } from '../operators/portContracts';
import type { OperatorSignal } from '../../types/operatorGraph';

const title = (value: string) => value.replace(/[-_:]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const COLORS: Record<string, string> = {
  image: '#78bded', texture: '#78bded', clip: '#e6a95c', depth: '#a9a9f8', geometry: '#e1ac72', mesh: '#e1ac72', landmarks: '#e5a0c8',
  material: '#cfa4eb', uv: '#74d4c4', anchors: '#e5a0c8', surface: '#e69687', force: '#b1d383', drag: '#b1d383',
  curves: '#eece78', curve: '#eece78', scene: '#a8bedc', audio: '#b1d383', number: '#c9ccd2', scalar: '#c9ccd2',
};
const GENERIC_FORMATS: Record<string, string[]> = {
  texture: ['2D image / color texture'], clip: ['Video readable at any moment (original source video)'], geometry: ['Geometry supplied by the connected clip or node'], mesh: ['Vertices + triangle indices'],
  audio: ['Decoded audio signal'], 'point-cloud': ['Spatial point data'], table: ['Structured rows / analysis values'],
  vector: ['Vector components'], curve: ['Ordered curve points'], mask: ['Mask coverage'], text: ['Text content'],
  metadata: ['Structured metadata'], event: ['Event signal'], time: ['Timeline time'], scene: ['Scene contribution'],
  timeline: ['Timeline contribution'], 'render-target': ['Rendered output'], binary: ['Binary payload'],
  number: ['Scalar number'], boolean: ['True / false'], string: ['String value'], document: ['Document content'],
};
const FLOCK_FORMATS: Record<string, string> = {
  spawn: 'Particle spawning configuration', behavior: 'Particle behavior / force configuration', obstacle: 'Obstacle configuration',
  boundary: 'Simulation boundary', path: 'Guidance path', particles: 'Flock particle state', curves: 'Flock links / trails',
  selection: 'Particle selection', scalar: 'Scalar value', palette: 'Color palette', scene: 'Flock render contribution',
};

/** One presentation source for canvas ports, tooltips, inspectors and the catalog. */
export function describeNodePort(port: { type: string; metadata?: NodeGraphPortMetadata }): NodePortContract & { color: string; formatLabels: string[] } {
  const semantic = port.metadata?.semanticKind, operatorType = semantic?.startsWith('operator:') ? semantic.slice(9) as OperatorSignal : undefined;
  const flockType = semantic?.startsWith('flock:') ? semantic.slice(6) : undefined;
  const known = operatorType && OPERATOR_SIGNAL_CONTRACTS[operatorType];
  const kind = operatorType ?? flockType ?? port.type;
  const fallback: NodePortContract = {
    typeLabel: title(flockType ?? port.type),
    description: flockType ? 'Flock signal. Connect to the same Flock signal type.' : port.type === 'clip'
      ? 'Time-addressable video. Unlike a texture, which is only the current frame, time effects such as Slit Scan read other moments of it.'
      : 'Intermediate graph signal. The owning node validates supported data and connections.',
    formats: flockType ? [FLOCK_FORMATS[flockType] ?? title(flockType)] : GENERIC_FORMATS[port.type] ?? [title(port.type)],
  };
  const contract = port.metadata?.contract ?? (known || fallback);
  return { ...contract, color: COLORS[kind] ?? '#afbdd0', formatLabels: contract.formats.map(signalFormatLabel) };
}

export function describePortText(port: { label: string; type: string; direction: 'input' | 'output'; metadata?: NodeGraphPortMetadata }): string {
  const info = describeNodePort(port), input = port.direction === 'input';
  return [
    `${input ? 'Input' : 'Output'}: ${port.label} · ${info.typeLabel}`,
    `${input ? 'Accepts' : 'Produces'}: ${info.formatLabels.join('; ')}`,
    info.description, ...(info.constraints ?? []),
    input ? `${port.metadata?.required ? 'Required' : 'Optional'} input · ${port.metadata?.repeated ? 'multiple connections' : 'one connection'}` : 'Can feed multiple compatible inputs.',
  ].join('\n');
}
