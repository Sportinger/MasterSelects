// Bestehende MXF-Aufrufer teilen die Engine mit MP4/HEVC.
export { GopDecodeEngine as MxfGopEngine, MAX_GOP_DECODE_QUEUE } from '../codec/GopDecodeEngine';
export type { GopDecoder, GopDecoderCallbacks, MxfGopEngineStats } from '../codec/GopDecodeEngine';
