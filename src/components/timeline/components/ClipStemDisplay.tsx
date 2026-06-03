import {
  IconDisc,
  IconGuitarPick,
  IconMicrophone,
  IconMusic,
  IconWaveSine,
} from '@tabler/icons-react';
import type { ClipStemSeparationJobStemChoice } from '../../../stores/timeline/types';
import type { AudioStemKind } from '../../../types/audio';

export const EMPTY_STEM_CHOICES: ClipStemSeparationJobStemChoice[] = [];

export function StemChoiceIcon({ kind }: { kind: AudioStemKind }) {
  switch (kind) {
    case 'vocals':
    case 'dialogue':
      return <IconMicrophone className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'drums':
      return <IconDisc className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'bass':
    case 'instrumental':
      return <IconGuitarPick className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'music':
      return <IconMusic className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
    case 'mix':
    case 'other':
    case 'sfx':
    default:
      return <IconWaveSine className="clip-stem-choice-icon" size={15} stroke={2.3} aria-hidden="true" />;
  }
}
