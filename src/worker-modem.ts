import type { AudibleProfile } from './modem';

export class WorkerModem {
  private worker = new Worker(new URL('./modem-worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private onFailure?: (error: Error) => void) {
    this.worker.onmessage = ({ data }) => {
      const call = this.pending.get(data.id); if (!call) return;
      clearTimeout(call.timer); this.pending.delete(data.id);
      if (data.error) call.reject(new Error(data.error)); else call.resolve(data);
    };
    this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(`Modem worker failed: ${event.message}`)); };
    this.worker.onmessageerror = () => this.fail(new Error('Modem worker message could not be read.'));
  }
  private fail(error: Error) { if (this.closed) return; this.dispose(error); this.onFailure?.(error); }
  private call(message: object, transfer: Transferable[] = []): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Modem worker stopped.'));
    if (this.pending.size >= 12) return Promise.reject(new Error('DSP queue full; capture cannot keep up.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('DSP worker timed out. Restart audio.')), 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ ...message, id }, transfer); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async init(sampleRate: number) {
    const runtimeUrl = new URL(`${import.meta.env.BASE_URL}vendor/ggwave-module.mjs`, location.href).href;
    await this.call({ kind: 'init', sampleRate, runtimeUrl });
  }
  async encode(bytes: Uint8Array, profile: AudibleProfile): Promise<Float32Array> { return (await this.call({ kind: 'encode', bytes, profile })).pcm; }
  decode(pcm: Float32Array): Promise<{ pcm: Float32Array; packets: Uint8Array[] }> { return this.call({ kind: 'decode', pcm }, [pcm.buffer as ArrayBuffer]); }
  async reset() { await this.call({ kind: 'reset' }); }
  dispose(error = new Error('Modem worker stopped.')) {
    if (this.closed) return; this.closed = true; this.worker.terminate();
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
  }
}
