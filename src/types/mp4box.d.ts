// Type declarations for mp4box.js

declare module 'mp4box' {
  export interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  export interface Sample {
    number: number;
    track_id: number;
    description_index: number;
    description: any;
    data: ArrayBuffer;
    size: number;
    cts: number;
    dts: number;
    duration: number;
    is_sync: boolean;
    timescale: number;
  }

  export interface MP4VideoTrack {
    id: number;
    codec: string;
    type: string;
    duration: number;
    timescale: number;
    nb_samples: number;
    video: {
      width: number;
      height: number;
    };
  }

  export interface MP4AudioTrack {
    id: number;
    codec: string;
    type: string;
    duration: number;
    timescale: number;
    nb_samples: number;
    audio: {
      sample_rate: number;
      channel_count: number;
    };
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    brands: string[];
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }

  export interface MP4File {
    onReady: (info: MP4Info) => void;
    onSamples: (trackId: number, ref: any, samples: Sample[]) => void;
    onError: (error: string) => void;
    appendBuffer: (buffer: MP4ArrayBuffer) => number;
    start: () => void;
    stop: () => void;
    flush: () => void;
    setExtractionOptions: (
      trackId: number,
      user?: any,
      options?: { nbSamples?: number; rapAlignement?: boolean }
    ) => void;
  }

  export function createFile(): MP4File;

  const MP4Box: {
    createFile: typeof createFile;
  };

  export default MP4Box;
}
