// Minimal QuickTime (.mov) muxer for HAP video plus optional PCM audio.
// HAP movies are structurally simple: one video track whose samples are all
// sync samples at a constant frame duration, optionally one 'sowt' 16-bit PCM
// sound track. Video samples are kept as individual Blobs so the browser can
// spill large exports out of the JS heap; finalize() assembles
// ftyp + mdat + moov without copying sample data again.

const MVHD_TIMESCALE = 600;
const AUDIO_CHUNK_SECONDS = 0.5;

class AtomWriter {
  private buffer: Uint8Array<ArrayBuffer>;
  private view: DataView;
  private length = 0;
  private readonly openAtoms: number[] = [];

  constructor(initialCapacity = 4096) {
    this.buffer = new Uint8Array(new ArrayBuffer(initialCapacity));
    this.view = new DataView(this.buffer.buffer);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let capacity = this.buffer.length * 2;
    while (capacity < this.length + extra) capacity *= 2;
    const next = new Uint8Array(new ArrayBuffer(capacity));
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number): void { this.ensure(1); this.view.setUint8(this.length, value); this.length += 1; }
  u16(value: number): void { this.ensure(2); this.view.setUint16(this.length, value); this.length += 2; }
  i16(value: number): void { this.ensure(2); this.view.setInt16(this.length, value); this.length += 2; }
  u24(value: number): void { this.u8((value >>> 16) & 0xff); this.u16(value & 0xffff); }
  u32(value: number): void { this.ensure(4); this.view.setUint32(this.length, value >>> 0); this.length += 4; }
  u64(value: number): void {
    this.u32(Math.floor(value / 0x100000000));
    this.u32(value >>> 0);
  }

  fourCC(code: string): void {
    this.ensure(4);
    for (let i = 0; i < 4; i++) {
      this.view.setUint8(this.length + i, code.charCodeAt(i) & 0xff);
    }
    this.length += 4;
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  zeros(count: number): void {
    this.ensure(count);
    this.buffer.fill(0, this.length, this.length + count);
    this.length += count;
  }

  /** 32-byte Pascal string used by video sample descriptions. */
  pascalString32(text: string): void {
    const truncated = text.slice(0, 31);
    this.u8(truncated.length);
    for (let i = 0; i < truncated.length; i++) this.u8(truncated.charCodeAt(i) & 0xff);
    this.zeros(31 - truncated.length);
  }

  beginAtom(type: string): void {
    this.openAtoms.push(this.length);
    this.u32(0);
    this.fourCC(type);
  }

  endAtom(): void {
    const start = this.openAtoms.pop();
    if (start === undefined) throw new Error('AtomWriter: endAtom without beginAtom');
    this.view.setUint32(start, this.length - start);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    if (this.openAtoms.length > 0) throw new Error('AtomWriter: unclosed atom');
    return this.buffer.slice(0, this.length);
  }
}

function identityMatrix(w: AtomWriter): void {
  w.u32(0x00010000); w.u32(0); w.u32(0);
  w.u32(0); w.u32(0x00010000); w.u32(0);
  w.u32(0); w.u32(0); w.u32(0x40000000);
}

function fullAtomHeader(w: AtomWriter, version: number, atomFlags: number): void {
  w.u8(version);
  w.u24(atomFlags);
}

export interface HapMovAudioTrack {
  /** Interleaved 16-bit little-endian PCM. */
  samples: Int16Array;
  sampleRate: number;
  channelCount: number;
}

export interface HapMovWriterOptions {
  /** Case-sensitive sample-description FourCC, e.g. 'Hap1'. */
  videoFourCC: string;
  width: number;
  height: number;
  fps: number;
  /** 24 for opaque flavors, 32 for alpha-carrying flavors. */
  depth?: number;
}

/** Collects encoded HAP samples and finalizes a QuickTime movie Blob. */
export class HapMovWriter {
  private readonly options: HapMovWriterOptions;
  private readonly sampleBlobs: Blob[] = [];
  private readonly sampleSizes: number[] = [];
  private audio: HapMovAudioTrack | null = null;

  constructor(options: HapMovWriterOptions) {
    if (options.width <= 0 || options.height <= 0) {
      throw new Error('HapMovWriter requires positive dimensions');
    }
    if (!Number.isFinite(options.fps) || options.fps <= 0) {
      throw new Error('HapMovWriter requires a positive fps');
    }
    if (options.videoFourCC.length !== 4) {
      throw new Error(`HapMovWriter FourCC must be 4 characters: ${options.videoFourCC}`);
    }
    this.options = options;
  }

  get sampleCount(): number {
    return this.sampleSizes.length;
  }

  addVideoSample(sample: Uint8Array): void {
    // Copy into a Blob immediately so the browser may move it off-heap.
    this.sampleBlobs.push(new Blob([sample.slice().buffer]));
    this.sampleSizes.push(sample.length);
  }

  setAudio(track: HapMovAudioTrack | null): void {
    if (track && (track.channelCount <= 0 || track.sampleRate <= 0)) {
      throw new Error('HapMovWriter audio track needs positive rate and channels');
    }
    this.audio = track && track.samples.length > 0 ? track : null;
  }

  finalize(): Blob {
    if (this.sampleSizes.length === 0) {
      throw new Error('HapMovWriter has no video samples');
    }

    const ftyp = new AtomWriter(32);
    ftyp.beginAtom('ftyp');
    ftyp.fourCC('qt  ');
    ftyp.u32(0x20050300);
    ftyp.fourCC('qt  ');
    ftyp.endAtom();
    const ftypBytes = ftyp.toBytes();

    const videoBytes = this.sampleSizes.reduce((sum, size) => sum + size, 0);
    const audioBytes = this.audio ? this.audio.samples.length * 2 : 0;
    const payloadBytes = videoBytes + audioBytes;
    const useLargeMdat = payloadBytes + 8 > 0xffffffff;
    const mdatHeaderSize = useLargeMdat ? 16 : 8;

    const mdatHeader = new AtomWriter(16);
    if (useLargeMdat) {
      mdatHeader.u32(1);
      mdatHeader.fourCC('mdat');
      mdatHeader.u64(mdatHeaderSize + payloadBytes);
    } else {
      mdatHeader.u32(mdatHeaderSize + payloadBytes);
      mdatHeader.fourCC('mdat');
    }

    const dataStart = ftypBytes.length + mdatHeaderSize;
    const videoOffsets: number[] = new Array(this.sampleSizes.length);
    let cursor = dataStart;
    for (let i = 0; i < this.sampleSizes.length; i++) {
      videoOffsets[i] = cursor;
      cursor += this.sampleSizes[i];
    }

    const audio = this.audio;
    let audioChunkOffsets: number[] = [];
    let audioFramesPerChunk = 0;
    let audioFrameCount = 0;
    if (audio) {
      const bytesPerFrame = audio.channelCount * 2;
      audioFrameCount = Math.floor(audio.samples.length / audio.channelCount);
      audioFramesPerChunk = Math.max(1, Math.round(audio.sampleRate * AUDIO_CHUNK_SECONDS));
      const chunkCount = Math.ceil(audioFrameCount / audioFramesPerChunk);
      audioChunkOffsets = new Array(chunkCount);
      for (let i = 0; i < chunkCount; i++) {
        audioChunkOffsets[i] = cursor + i * audioFramesPerChunk * bytesPerFrame;
      }
    }

    const moovBytes = this.buildMoov({
      videoOffsets,
      audioChunkOffsets,
      audioFramesPerChunk,
      audioFrameCount,
    });

    const parts: BlobPart[] = [ftypBytes, mdatHeader.toBytes(), ...this.sampleBlobs];
    if (audio) {
      // TypedArray memory is little-endian on every supported platform, which
      // matches the 'sowt' sample layout.
      const pcmBytes = new Uint8Array(new ArrayBuffer(audio.samples.length * 2));
      pcmBytes.set(new Uint8Array(
        audio.samples.buffer,
        audio.samples.byteOffset,
        audio.samples.length * 2,
      ));
      parts.push(pcmBytes);
    }
    parts.push(moovBytes);
    return new Blob(parts, { type: 'video/quicktime' });
  }

  private buildMoov(layout: {
    videoOffsets: number[];
    audioChunkOffsets: number[];
    audioFramesPerChunk: number;
    audioFrameCount: number;
  }): Uint8Array<ArrayBuffer> {
    const { fps } = this.options;
    const videoTimescale = Math.max(1, Math.round(fps * 1000));
    const videoSampleDelta = 1000;
    const videoDuration = this.sampleSizes.length * videoSampleDelta;
    const videoDurationSeconds = videoDuration / videoTimescale;
    const audio = this.audio;
    const audioDurationSeconds = audio ? layout.audioFrameCount / audio.sampleRate : 0;
    const movieDurationSeconds = Math.max(videoDurationSeconds, audioDurationSeconds);
    const movieDuration = Math.round(movieDurationSeconds * MVHD_TIMESCALE);

    const w = new AtomWriter(64 * 1024);
    w.beginAtom('moov');

    w.beginAtom('mvhd');
    fullAtomHeader(w, 0, 0);
    w.u32(0); w.u32(0);
    w.u32(MVHD_TIMESCALE);
    w.u32(movieDuration);
    w.u32(0x00010000);
    w.u16(0x0100);
    w.u16(0);
    w.u32(0); w.u32(0);
    identityMatrix(w);
    w.zeros(24);
    w.u32(audio ? 3 : 2);
    w.endAtom();

    this.writeVideoTrak(w, {
      trackId: 1,
      timescale: videoTimescale,
      sampleDelta: videoSampleDelta,
      duration: videoDuration,
      movieDuration,
      offsets: layout.videoOffsets,
    });

    if (audio) {
      this.writeAudioTrak(w, {
        trackId: 2,
        movieDuration,
        chunkOffsets: layout.audioChunkOffsets,
        framesPerChunk: layout.audioFramesPerChunk,
        frameCount: layout.audioFrameCount,
      });
    }

    w.endAtom();
    return w.toBytes();
  }

  private writeVideoTrak(w: AtomWriter, params: {
    trackId: number;
    timescale: number;
    sampleDelta: number;
    duration: number;
    movieDuration: number;
    offsets: number[];
  }): void {
    const { width, height, videoFourCC } = this.options;
    w.beginAtom('trak');

    w.beginAtom('tkhd');
    fullAtomHeader(w, 0, 0x7);
    w.u32(0); w.u32(0);
    w.u32(params.trackId);
    w.u32(0);
    w.u32(params.movieDuration);
    w.u32(0); w.u32(0);
    w.u16(0); w.u16(0); w.u16(0); w.u16(0);
    identityMatrix(w);
    w.u32(width << 16);
    w.u32(height << 16);
    w.endAtom();

    w.beginAtom('mdia');
    w.beginAtom('mdhd');
    fullAtomHeader(w, 0, 0);
    w.u32(0); w.u32(0);
    w.u32(params.timescale);
    w.u32(params.duration);
    w.u16(0x55c4);
    w.u16(0);
    w.endAtom();

    w.beginAtom('hdlr');
    fullAtomHeader(w, 0, 0);
    w.fourCC('mhlr');
    w.fourCC('vide');
    w.u32(0); w.u32(0); w.u32(0);
    w.pascalString32('VideoHandler');
    w.endAtom();

    w.beginAtom('minf');
    w.beginAtom('vmhd');
    fullAtomHeader(w, 0, 1);
    w.u16(0); w.u16(0); w.u16(0); w.u16(0);
    w.endAtom();
    this.writeDinf(w);

    w.beginAtom('stbl');
    w.beginAtom('stsd');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom(videoFourCC);
    w.zeros(6);
    w.u16(1);
    w.u16(0); w.u16(0);
    w.u32(0);
    w.u32(0); w.u32(0);
    w.u16(width); w.u16(height);
    w.u32(0x00480000); w.u32(0x00480000);
    w.u32(0);
    w.u16(1);
    w.pascalString32('Hap');
    w.u16(this.options.depth ?? 24);
    w.i16(-1);
    w.endAtom();
    w.endAtom();

    w.beginAtom('stts');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(this.sampleSizes.length);
    w.u32(params.sampleDelta);
    w.endAtom();

    w.beginAtom('stsc');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(1); w.u32(1); w.u32(1);
    w.endAtom();

    w.beginAtom('stsz');
    fullAtomHeader(w, 0, 0);
    w.u32(0);
    w.u32(this.sampleSizes.length);
    for (const size of this.sampleSizes) w.u32(size);
    w.endAtom();

    this.writeChunkOffsets(w, params.offsets);
    w.endAtom(); // stbl
    w.endAtom(); // minf
    w.endAtom(); // mdia
    w.endAtom(); // trak
  }

  private writeAudioTrak(w: AtomWriter, params: {
    trackId: number;
    movieDuration: number;
    chunkOffsets: number[];
    framesPerChunk: number;
    frameCount: number;
  }): void {
    const audio = this.audio;
    if (!audio) return;
    w.beginAtom('trak');

    w.beginAtom('tkhd');
    fullAtomHeader(w, 0, 0x7);
    w.u32(0); w.u32(0);
    w.u32(params.trackId);
    w.u32(0);
    w.u32(params.movieDuration);
    w.u32(0); w.u32(0);
    w.u16(0); w.u16(1);
    w.u16(0x0100); w.u16(0);
    identityMatrix(w);
    w.u32(0); w.u32(0);
    w.endAtom();

    w.beginAtom('mdia');
    w.beginAtom('mdhd');
    fullAtomHeader(w, 0, 0);
    w.u32(0); w.u32(0);
    w.u32(audio.sampleRate);
    w.u32(params.frameCount);
    w.u16(0x55c4);
    w.u16(0);
    w.endAtom();

    w.beginAtom('hdlr');
    fullAtomHeader(w, 0, 0);
    w.fourCC('mhlr');
    w.fourCC('soun');
    w.u32(0); w.u32(0); w.u32(0);
    w.pascalString32('SoundHandler');
    w.endAtom();

    w.beginAtom('minf');
    w.beginAtom('smhd');
    fullAtomHeader(w, 0, 0);
    w.u16(0); w.u16(0);
    w.endAtom();
    this.writeDinf(w);

    w.beginAtom('stbl');
    w.beginAtom('stsd');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom('sowt');
    w.zeros(6);
    w.u16(1);
    w.u16(0); w.u16(0);
    w.u32(0);
    w.u16(audio.channelCount);
    w.u16(16);
    w.u16(0);
    w.u16(0);
    w.u32(audio.sampleRate << 16);
    w.endAtom();
    w.endAtom();

    w.beginAtom('stts');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.u32(params.frameCount);
    w.u32(1);
    w.endAtom();

    const fullChunks = Math.floor(params.frameCount / params.framesPerChunk);
    const remainder = params.frameCount - fullChunks * params.framesPerChunk;
    w.beginAtom('stsc');
    fullAtomHeader(w, 0, 0);
    if (remainder > 0 && fullChunks > 0) {
      w.u32(2);
      w.u32(1); w.u32(params.framesPerChunk); w.u32(1);
      w.u32(fullChunks + 1); w.u32(remainder); w.u32(1);
    } else {
      w.u32(1);
      w.u32(1);
      w.u32(remainder > 0 ? remainder : params.framesPerChunk);
      w.u32(1);
    }
    w.endAtom();

    w.beginAtom('stsz');
    fullAtomHeader(w, 0, 0);
    w.u32(audio.channelCount * 2);
    w.u32(params.frameCount);
    w.endAtom();

    this.writeChunkOffsets(w, params.chunkOffsets);
    w.endAtom(); // stbl
    w.endAtom(); // minf
    w.endAtom(); // mdia
    w.endAtom(); // trak
  }

  private writeDinf(w: AtomWriter): void {
    w.beginAtom('dinf');
    w.beginAtom('dref');
    fullAtomHeader(w, 0, 0);
    w.u32(1);
    w.beginAtom('url ');
    fullAtomHeader(w, 0, 1);
    w.endAtom();
    w.endAtom();
    w.endAtom();
  }

  private writeChunkOffsets(w: AtomWriter, offsets: number[]): void {
    const needs64 = offsets.length > 0 && offsets[offsets.length - 1] > 0xffffffff;
    w.beginAtom(needs64 ? 'co64' : 'stco');
    fullAtomHeader(w, 0, 0);
    w.u32(offsets.length);
    for (const offset of offsets) {
      if (needs64) w.u64(offset);
      else w.u32(offset);
    }
    w.endAtom();
  }
}
