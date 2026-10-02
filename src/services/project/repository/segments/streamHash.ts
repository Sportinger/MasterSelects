/** Incremental SHA-256 keeps only one 64-byte block, including for original media. */
export class StreamHash {
  private readonly state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly block = new Uint8Array(64);
  private readonly blockView = new DataView(this.block.buffer);
  private readonly words = new Uint32Array(64);
  private used = 0;
  private size = 0;
  private finished = false;
  update(bytes: Uint8Array): void {
    if (this.finished) throw new Error('Hash already completed');
    this.size += bytes.length;
    let offset = 0;
    if (this.used) {
      const count = Math.min(64 - this.used, bytes.length);
      this.block.set(bytes.subarray(0, count), this.used); this.used += count; offset = count;
      if (this.used === 64) { this.compress(); this.used = 0; }
    }
    // A multi-GB original contains millions of blocks: reuse scratch memory and read
    // complete blocks directly instead of allocating/copying for every 64 bytes.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 64 <= bytes.length) { this.compress(view, offset); offset += 64; }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), this.used);
      this.used += bytes.length - offset;
    }
  }
  digest(): string {
    if (this.finished) throw new Error('Hash already completed');
    const bitLength = BigInt(this.size) * 8n;
    this.block[this.used++] = 0x80;
    if (this.used > 56) { this.block.fill(0, this.used); this.compress(); this.used = 0; }
    this.block.fill(0, this.used, 56);
    new DataView(this.block.buffer).setBigUint64(56, bitLength);
    this.compress(); this.finished = true;
    return `sha256:${Array.from(this.state, word => word.toString(16).padStart(8, '0')).join('')}`;
  }
  private compress(view: DataView = this.blockView, offset = 0): void {
    const words = this.words;
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = (words[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let a = this.state[0], b = this.state[1], c = this.state[2], d = this.state[3];
    let e = this.state[4], f = this.state[5], g = this.state[6], h = this.state[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + words[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.state[0] = (this.state[0] + a) >>> 0; this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0; this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0; this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0; this.state[7] = (this.state[7] + h) >>> 0;
  }
}
const rotr = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
