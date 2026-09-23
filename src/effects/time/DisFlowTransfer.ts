import type { ResidentMotionFrames } from './residentMotionFrames';

const tileOrigin = (snapshot: ResidentMotionFrames, time: number) => {
  const slot = snapshot.slots.get(time);
  if (slot === undefined) throw new Error('DIS pair is no longer resident.');
  return { x: slot%snapshot.columns*snapshot.width,
    y: Math.floor(slot/snapshot.columns)%snapshot.rows*snapshot.height,
    z: Math.floor(slot/(snapshot.columns*snapshot.rows)) };
};

/** Only completed analysis tiles cross CPU/GPU for durable storage. Normal
 * geometry and playback keep using device-local textures without readbacks. */
export async function readDisTile(device: GPUDevice, texture: GPUTexture, snapshot: ResidentMotionFrames, time: number) {
  const row = snapshot.width*8, stride = Math.ceil(row/256)*256;
  const buffer = device.createBuffer({ size: stride*snapshot.height, usage: GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ });
  try {
    const encoder = device.createCommandEncoder({ label:'persist-dis-pair' });
    encoder.copyTextureToBuffer({ texture,origin:tileOrigin(snapshot,time) },{ buffer,bytesPerRow:stride },[snapshot.width,snapshot.height]);
    device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange()), packed = new Uint8Array(row*snapshot.height);
    for(let y=0;y<snapshot.height;y++) packed.set(mapped.subarray(y*stride,y*stride+row),y*row);
    return packed;
  } finally { if(buffer.mapState==='mapped')buffer.unmap();buffer.destroy(); }
}

export function uploadDisTile(device: GPUDevice, texture: GPUTexture, snapshot: ResidentMotionFrames, time: number, bytes: Uint8Array<ArrayBuffer>): void {
  device.queue.writeTexture({ texture,origin:tileOrigin(snapshot,time) },bytes,{ bytesPerRow:snapshot.width*8 },[snapshot.width,snapshot.height]);
}
