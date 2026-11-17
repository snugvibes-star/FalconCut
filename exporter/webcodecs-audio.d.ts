/**
 * Ambient types for the audio half of WebCodecs (AudioEncoder / AudioData /
 * EncodedAudioChunk). TypeScript 5.6's lib.dom ships the video half only; the
 * audio half is present in all WebCodecs-capable browsers at runtime.
 */
type AudioSampleFormat =
  | 'u8' | 's16' | 's32' | 'f32'
  | 'u8-planar' | 's16-planar' | 's32-planar' | 'f32-planar';

interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: BufferSource;
}

interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate?: number;
  bitrateMode?: 'constant' | 'variable';
  latencyMode?: 'quality' | 'realtime';
}

interface EncodedAudioChunk {
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: AudioDecoderConfig;
}

interface AudioDataInit {
  format: AudioSampleFormat;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  timestamp: number;
  data: BufferSource;
}

interface AudioData {
  readonly format: AudioSampleFormat;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly timestamp: number;
  readonly duration: number;
  close(): void;
}

declare var AudioData: {
  prototype: AudioData;
  new (init: AudioDataInit): AudioData;
};

interface AudioEncoder {
  readonly encodeQueueSize: number;
  readonly state: 'unconfigured' | 'configured' | 'closed';
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  addEventListener(type: 'dequeue', listener: () => void): void;
  removeEventListener(type: 'dequeue', listener: () => void): void;
}

declare var AudioEncoder: {
  prototype: AudioEncoder;
  new (init: {
    output: (chunk: EncodedAudioChunk, metadata?: EncodedAudioChunkMetadata) => void;
    error: (error: Error) => void;
  }): AudioEncoder;
  isConfigSupported(config: AudioEncoderConfig): Promise<{ supported: boolean; config?: AudioEncoderConfig }>;
};