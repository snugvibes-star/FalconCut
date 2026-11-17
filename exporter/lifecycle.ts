export type BlobLoader = (key: string) => Promise<Blob | undefined>;

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

/** Also disposes resources produced after an uncancellable browser operation finishes. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal, dispose?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true; reject(new DOMException('Export cancelled.', 'AbortError')); };
    if (cancelled) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener('abort', abort);
      if (cancelled) dispose?.(value);
      else resolve(value);
    }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
