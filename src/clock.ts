export interface Clock {
  now(): number;
  random(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
export const aborted = (signal: AbortSignal) => signal.reason ?? new Error('Cancelled.');
export const systemClock: Clock = {
  now: () => performance.now(), random: () => Math.random(),
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(aborted(signal)); return; }
      const cancel = () => { clearTimeout(timer); reject(aborted(signal)); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
  },
};

/** Deterministic clock used by transport fault tests and the explicitly local PCM simulator. */
export class VirtualClock implements Clock {
  private time = 0;
  private seed: number;
  private tasks: { at: number; run: () => void }[] = [];
  constructor(seed = 1) { this.seed = seed; }
  now() { return this.time; }
  random() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 0x100000000; }
  sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(aborted(signal)); return; }
      const remove = () => { this.tasks = this.tasks.filter(t => t !== task); signal.removeEventListener('abort', cancel); };
      const cancel = () => { remove(); reject(aborted(signal)); };
      const task = { at: this.time + ms, run: () => { remove(); resolve(); } };
      this.tasks.push(task); signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
  async next() {
    await this.flush();
    const next = this.tasks.reduce<number | undefined>((min, t) => min === undefined ? t.at : Math.min(min, t.at), undefined);
    if (next === undefined) return false;
    this.time = next;
    for (const task of [...this.tasks].filter(t => t.at === next)) task.run();
    await this.flush(); return true;
  }
  async drive<T>(promise: Promise<T>, yieldToUI = false): Promise<T> {
    let done = false;
    // Attach rejection handler immediately; errors are rethrown to the caller below.
    void promise.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 20000; i++) {
      if (yieldToUI && i % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      await this.flush(); if (done) return promise;
      if (!await this.next()) throw new Error('Virtual clock stalled with unfinished work.');
    }
    throw new Error('Virtual clock step limit exceeded.');
  }
}
