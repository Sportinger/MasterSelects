// Node benchmark: decodes packets sliced from MXF (via ffprobe golden pos/size) with the wasm build.
// Usage: node bench.mjs <file.mxf> <decoder> [workers=1] [rounds=3]
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, workerData, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

if (isMainThread) {
  const [file, decoder, w = '1', r = '3'] = process.argv.slice(2);
  const golden = JSON.parse(readFileSync(file.replace(/\.mxf$/, '.golden.json'), 'utf8'));
  const vs = golden.streams.find((s) => s.codec_type === 'video').index;
  const pk = golden.packets.filter((p) => p.stream_index === vs).map((p) => [Number(p.pos), Number(p.size)]);
  const buf = readFileSync(file);
  // golden `pos` is the KLV key; payload starts after the 16-byte key and the BER length
  const payloadStart = (pos) => { const b = buf[pos + 16]; return pos + 16 + (b & 0x80 ? 1 + (b & 0x7f) : 1); };
  const packets = pk.map(([pos, size]) => { const s = payloadStart(pos); return buf.subarray(s, s + size); });
  const workers = Number(w); const rounds = Number(r);
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: workers }, () => new Promise((res, rej) => {
    const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { packets: packets.map((p) => new Uint8Array(p)), decoder, rounds } });
    wk.on('message', res); wk.on('error', rej);
  })));
  const ms = performance.now() - t0;
  const frames = results.reduce((a, b) => a + b.frames, 0);
  const per = results.map((x) => x.fps);
  console.log(JSON.stringify({ file: file.split(/[\/]/).pop(), decoder, workers, frames, fpsTotal: +(frames / ms * 1000).toFixed(1), fpsPerWorkerMedian: per.toSorted((a, b) => a - b)[Math.floor(per.length / 2)], format: results[0].fmt, size: results[0].size }));
} else {
  const { packets, decoder, rounds } = workerData;
  const create = (await import('./out/libavcodec.js')).default;
  const M = await create();
  const dec = M._dec_open(M.stringToNewUTF8 ? M.stringToNewUTF8(decoder) : (() => { const b = new TextEncoder().encode(decoder + '\0'); const p = M._dec_malloc(b.length); M.HEAPU8.set(b, p); return p; })(), 0, 0, 1);
  if (!dec) throw new Error('dec_open failed ' + decoder);
  let frames = 0; let fmt = -1; let size = '';
  const t0 = performance.now();
  for (let r = 0; r < rounds; r++) {
    M._dec_flush(dec);
    for (let i = 0; i < packets.length; i++) {
      const p = packets[i]; const ptr = M._dec_malloc(p.length); M.HEAPU8.set(p, ptr);
      const s = M._dec_send(dec, ptr, p.length, i); M._dec_free(ptr);
      if (s < 0) throw new Error('send ' + s);
      while (M._dec_receive(dec) === 0) { frames++; fmt = M._dec_pix_fmt(dec); size = M._dec_width(dec) + 'x' + M._dec_height(dec); }
    }
    M._dec_send(dec, 0, 0, 0); while (M._dec_receive(dec) === 0) { frames++; }
  }
  const ms = performance.now() - t0;
  M._dec_close(dec);
  parentPort.postMessage({ frames, fps: +(frames / ms * 1000).toFixed(1), fmt, size });
}
