// ProRes packet reader selection: MOV/MP4 through Mediabunny, MXF (RDD 44)
// through the TypeScript MXF packet source. Both feed the same TurboRes provider.

import { isMxfFile } from '../../mediaMetadata/mxf/mxfMediaMetadata';
import { MxfPacketSource, type MxfPacket } from '../mxf/MxfPacketSource';
import type { TurboResProResFourCC } from './turboResCodecIdentity';
import {
  TurboResPacketSource,
  type TurboResPacket,
  type TurboResPacketReader,
} from './TurboResPacketSource';

async function createMxfProResPacketReader(
  file: File,
  fourCC: TurboResProResFourCC,
): Promise<TurboResPacketReader> {
  const source = await MxfPacketSource.create(file, fourCC);
  if (source.mxf.video?.interlaced) {
    throw new Error('Interlaced ProRes in MXF is not enabled');
  }
  return {
    metadata: { ...source.metadata, fourCC },
    getPacketAt: (timeSeconds) => source.getPacketAt(timeSeconds),
    // Packets handed back here were produced by this source.
    getNextPacket: (packet: TurboResPacket) => source.getNextPacket(packet as MxfPacket),
    dispose: () => source.dispose(),
  };
}

export async function createProResPacketReader(
  file: File,
  fourCC: TurboResProResFourCC,
): Promise<TurboResPacketReader> {
  return await isMxfFile(file)
    ? createMxfProResPacketReader(file, fourCC)
    : TurboResPacketSource.create(file, fourCC);
}
