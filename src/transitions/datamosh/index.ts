import type { TransitionDefinition } from '../types';

export const DATAMOSH_BAKE_FORMAT = 'mpeg4-part2-keydrop-h264-mp4-v7';

/**
 * Codec-domain datamosh transition.
 *
 * The normal recipe is deliberately only a clean incoming-frame fallback.
 * Once baked, the transition composition swaps this for a seekable cache of
 * pixels decoded from the MPEG-4 stream after its junction I-frame was removed.
 */
export const datamosh: TransitionDefinition = {
  id: 'datamosh',
  name: 'Datamosh',
  category: 'glitch',
  defaultDuration: 2,
  minDuration: 0.2,
  maxDuration: 8,
  defaultPlacement: 'start-at-cut',
  description: 'Codec-domain I-frame removal using the incoming clip as motion donor',
  params: {
    bitrateMbps: {
      type: 'number',
      label: 'Data Rate',
      defaultValue: 2,
      min: 0.25,
      max: 20,
      step: 0.25,
    },
    bakedMediaFileId: {
      type: 'string',
      label: 'Baked media',
      defaultValue: '',
      hidden: true,
    },
    bakedDuration: {
      type: 'number',
      label: 'Baked duration',
      defaultValue: 0,
      min: 0,
      max: 86_400,
      hidden: true,
    },
    bakedBitrateMbps: {
      type: 'number',
      label: 'Baked data rate',
      defaultValue: 0,
      min: 0,
      max: 20,
      hidden: true,
    },
    bakedFormat: {
      type: 'string',
      label: 'Baked codec format',
      defaultValue: '',
      hidden: true,
    },
  },
  recipe: [
    {
      kind: 'opacity',
      target: 'outgoing',
      from: 0,
      to: 0,
    },
    {
      kind: 'opacity',
      target: 'incoming',
      from: 1,
      to: 1,
    },
  ],
};
