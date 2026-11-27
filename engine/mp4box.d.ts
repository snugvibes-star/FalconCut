/**
 * Minimal typings for the parts of mp4box.js that FalconCut uses.
 * The package ships no .d.ts; these cover ISO-BMFF probing and per-track
 * sample extraction without pretending to model the whole library.
 */
declare module 'mp4box' {
  export interface MP4Descriptor {
    tag: number;
    descs?: MP4Descriptor[];
    data?: Uint8Array;
  }

  export interface MP4BoxInfo {
    type: string;
    data?: Uint8Array;
    esds?: { esd?: { descs?: MP4Descriptor[] } };
  }

  export interface MP4SampleEntry extends MP4BoxInfo {
    samplerate?: number;
    channel_count?: number;
    samplesize?: number;
    boxes: MP4BoxInfo[];
  }

  export interface MP4TrackInfo {
    id: number;
    codec: string;
    language?: string;
    name?: string;
    timescale: number;
    duration: number;
    nb_samples: number;
    bitrate?: number;
    audio?: {
      sample_rate?: number;
      channel_count?: number;
      sample_size?: number;
    };
    video?: { width: number; height: number };
    edits?: { media_time?: number; segment_duration?: number }[];
  }

  export interface MP4Info {
    duration: number;
    timescale: number;
    tracks: MP4TrackInfo[];
    audioTracks?: MP4TrackInfo[];
    videoTracks?: MP4TrackInfo[];
  }

  export interface MP4Sample {
    data: Uint8Array;
    size: number;
    cts: number;
    dts: number;
    duration: number;
    timescale: number;
    is_sync: boolean;
  }

  export interface MP4TrakBox {
    mdia: {
      mdhd: { timescale: number; language?: string };
      minf: {
        stbl: {
          stsd: { entries: MP4SampleEntry[] };
        };
      };
    };
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((error: string) => void) | null;
    onSamples: ((id: number, user: unknown, samples: MP4Sample[]) => void) | null;
    appendBuffer(buffer: ArrayBuffer & { fileStart?: number }, last?: boolean): number | undefined;
    setExtractionOptions(id: number, user?: unknown, options?: { nbSamples?: number }): void;
    start(): void;
    stop(): void;
    flush(): void;
    getTrackById(id: number): MP4TrakBox;
  }

  export interface MP4Module {
    createFile(): MP4File;
  }

  const MP4Box: MP4Module;
  export default MP4Box;
}
