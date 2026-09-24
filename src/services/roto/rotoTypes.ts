/** Source-space segmentation; timestamps always refer to decoded source frames. */
export interface RotoPoint { x: number; y: number; label: 0 | 1 }
export interface RotoMask { time: number; duration: number; width: number; height: number; data: Uint8Array }
export interface RotoConstants {
  image_size: number; feat_size: number; hidden_dim: number; mem_dim: number;
  num_maskmem: number; max_object_pointers: number;
  memory_temporal_positional_encoding: number[][]; image_mean: number[]; image_std: number[];
}
export type RotoRequest =
  | { type: 'load' }
  | { type: 'seed'; pixels: ImageData; points: RotoPoint[]; totalFrames: number }
  | { type: 'step'; pixels: ImageData };
export interface RotoReply { id: number; error?: string; progress?: number; message?: string; mask?: Uint8Array; width?: number; height?: number }
