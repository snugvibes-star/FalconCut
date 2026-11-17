/** WAV (PCM 16-bit) encoder for AudioBuffers — shared by export artifacts
 * and by "extract audio from video" in the media workflow. */
export function encodeWAV(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const bytes = buffer.length * channels * 2;
  const out = new ArrayBuffer(44 + bytes);
  const view = new DataView(out);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint32(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes, true);
  const samples = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < buffer.length; i++) for (let c = 0; c < channels; c++) {
    const value = Math.max(-1, Math.min(1, samples[c][i]));
    view.setInt16(44 + (i * channels + c) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return new Blob([out], { type: 'audio/wav' });
}
