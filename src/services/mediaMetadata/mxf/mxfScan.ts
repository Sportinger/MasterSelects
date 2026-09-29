// Sequential KLV scan of one partition's metadata region: primer, header
// metadata sets and index table segments. Stops at the first essence/other KLV,
// so it does not trust HeaderByteCount (FFmpeg under-reports it).

import type { MxfByteSource } from './mxfByteSource';
import {
  MxfHeaderMetadataBuilder,
  isIndexSegmentKey,
  isMetadataSetKey,
  parseLocalSet,
  parsePrimerValue,
  type MxfHeaderMetadata,
} from './mxfHeaderMetadata';
import { parseIndexSegment, type MxfIndexSegment } from './mxfIndex';
import { isFillKey, isPrimerKey, parseKlvHeader } from './mxfKlv';
import type { MxfPartition } from './mxfPartitions';

const KLV_PROBE_SIZE = 32;
const MAX_SCAN_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_SCAN_KLVS = 100_000;

export interface MxfPartitionScan {
  metadata: MxfHeaderMetadata;
  indexSegments: MxfIndexSegment[];
  /** Offset of the first KLV that ended the metadata/index region. */
  endOffset: number;
}

export async function scanPartition(
  source: MxfByteSource,
  partition: MxfPartition,
): Promise<MxfPartitionScan> {
  const builder = new MxfHeaderMetadataBuilder();
  const indexSegments: MxfIndexSegment[] = [];
  let offset = partition.packEnd;
  let scannedBytes = 0;
  for (let n = 0; n < MAX_SCAN_KLVS && offset < source.size; n += 1) {
    const probe = await source.read(offset, KLV_PROBE_SIZE);
    const klv = parseKlvHeader(probe, 0, offset);
    if (!klv || klv.end > source.size) break;
    if (isFillKey(klv.key)) {
      offset = klv.end;
      continue;
    }
    const wanted = isPrimerKey(klv.key) || isMetadataSetKey(klv.key);
    if (!wanted) break;
    scannedBytes += klv.length;
    if (scannedBytes > MAX_SCAN_VALUE_BYTES) break;
    const value = await source.read(klv.valueOffset, klv.length);
    if (value.length < klv.length) break;
    if (isPrimerKey(klv.key)) {
      parsePrimerValue(value, 0, builder.primer);
    } else {
      const set = parseLocalSet(klv.key, value, 0, value.length);
      if (isIndexSegmentKey(klv.key)) indexSegments.push(parseIndexSegment(set));
      else if (set.instanceUid) builder.addSet(set);
    }
    offset = klv.end;
  }
  return { metadata: builder.build(), indexSegments, endOffset: offset };
}
