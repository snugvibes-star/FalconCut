import { describe, it, expect } from 'vitest';
import { TranscriptionJob, autoChunkSec } from '../analysis/transcriptionJob';

function fakeClient(failOffsets: number[] = []) {
  return {
    calls: [] as number[],
    cancelled: false,
    async transcribeSegment(_audio: Float32Array, offset: number) {
      this.calls.push(offset);
      if (failOffsets.includes(offset)) throw new Error('inference failed');
      return {
        out: { chunks: [{ text: 'hello world', timestamp: [1, 2] }] },
        estimated: true,
        mode: 'chunk',
      };
    },
    cancelAll() { this.cancelled = true; },
  };
}

describe('automatic background chunking', () => {
  it('chooses safe chunk sizes automatically', () => {
    expect(autoChunkSec(30)).toBe(30);
    expect(autoChunkSec(600)).toBe(30);
    expect(autoChunkSec(1200)).toBe(15);
  });

  it('splits the last segment correctly and maps timestamps to video time', async () => {
    const client = fakeClient();
    let done: any = null;
    const job = new TranscriptionJob(client as any, {
      audio: new Float32Array(16000 * 75),
      durationSec: 75,
      model: 'onnx-community/whisper-tiny',
      chunkSec: 30,
      overlapSec: 2,
      autoRetry: false,
      onProgress: () => {},
      onDone: (r) => { done = r; },
      onError: () => {},
    });
    expect(job.total).toBe(3);
    job.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(client.calls).toEqual([0, 28, 56]);
    expect(done.words.length).toBeGreaterThan(0);
    expect(done.words.some((w: any) => w.start > 55)).toBe(true); // third segment offset applied
    expect(done.estimated).toBe(true);
  });

  it('keeps completed chunks and retries only failed ones', async () => {
    const failOffsets = [28];
    const client = fakeClient(failOffsets);
    let error = '';
    let progress: any = null;
    const job = new TranscriptionJob(client as any, {
      audio: new Float32Array(16000 * 70),
      durationSec: 70,
      model: 'onnx-community/whisper-tiny',
      chunkSec: 30,
      overlapSec: 2,
      autoRetry: false,
      onProgress: (p) => { progress = p; },
      onDone: () => {},
      onError: (msg) => { error = msg; },
    });
    job.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(progress.completed).toBe(2);
    expect(progress.failed).toBe(1);
    expect(error).toContain('1 chunk failed');
    expect(client.calls).toEqual([0, 28, 56]);

    client.calls.length = 0;
    failOffsets.length = 0; // the failing segment now succeeds
    error = '';
    job.retryFailed();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(client.calls).toEqual([28]);
  });
});
