import { systemClock, type Clock } from './clock';
import { decodePacket, encodePacket, Kind } from './protocol';

export type RangeIdentity = { session: number; transfer: number };
export type RangeResult = { status: 'measuring' | 'unavailable' } | { status: 'estimated'; metres: number };

interface RangingAudio {
  readonly sampleRate?: number;
  readonly listening: boolean;
  onRangeCapture?: (pcm: Float32Array, startTime: number) => void;
  playRangeProbe(pcm: Float32Array, signal: AbortSignal): Promise<void>;
  send(bytes: Uint8Array, signal: AbortSignal, showWaveform?: boolean): Promise<void>;
  subscribe(receiver: (bytes: Uint8Array) => void): () => void;
}

const MAX_METRES = 12;
const SPEED_OF_SOUND = 343; // m/s in air near room temperature
const DEADLINE = 12000;
const GUARD = 400;

export function rangeProbe(rate: number, identity: RangeIdentity, reply: boolean) {
  const duration = .032;
  const data = new Float32Array(Math.round(rate * duration));
  const offset = ((identity.session ^ identity.transfer) >>> 0) % 11 * 24;
  const start = (reply ? 3550 : 900) + offset;
  const sweep = reply ? -1200 : 1180;
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t / .003, (duration - t) / .003);
    data[i] = .7 * envelope * Math.sin(2 * Math.PI * (start * t + sweep * t * t / (2 * duration)));
  }
  return data;
}

/** A bounded, normalized matched filter on the microphone sample clock. */
export class ProbeDetector {
  private readonly stride: number;
  private readonly template: Float32Array;
  private readonly energy: number;
  private readonly window: Float32Array;
  private previous?: number;
  private used = 0;

  constructor(private readonly rate: number, probe: Float32Array) {
    this.stride = Math.max(1, Math.floor(rate / 9600));
    this.template = Float32Array.from({length: Math.floor(probe.length / this.stride)}, (_, i) => probe[i * this.stride]);
    this.energy = this.template.reduce((sum, sample) => sum + sample * sample, 0);
    this.window = new Float32Array(this.template.length + Math.ceil(4096 / this.stride));
  }

  push(samples: Float32Array, startTime: number): number | undefined {
    const first = Math.round(startTime * this.rate);
    if (this.previous !== first) this.used = 0;
    this.previous = first + samples.length;
    const offset = (this.stride - first % this.stride) % this.stride;
    const origin = first + offset - this.used * this.stride;
    for (let i = offset; i < samples.length; i += this.stride) this.window[this.used++] = samples[i];
    let best = .64, match: number | undefined;
    const last = this.used - this.template.length;
    for (let i = 0; i <= last; i++) {
      let dot = 0, power = 0;
      for (let j = 0; j < this.template.length; j++) {
        const value = this.window[i + j];
        dot += value * this.template[j];
        power += value * value;
      }
      if (power < this.template.length * .000002) continue;
      const score = Math.abs(dot) / Math.sqrt(power * this.energy);
      if (score > best) { best = score; match = (origin + i * this.stride) / this.rate; }
    }
    const remaining = Math.min(this.used, this.template.length - 1);
    this.window.copyWithin(0, this.used - remaining, this.used);
    this.used = remaining;
    return match;
  }
}

export function distanceFromIntervals(senderSeconds: number, receiverSeconds: number): number | undefined {
  const metres = (senderSeconds - receiverSeconds) * SPEED_OF_SOUND / 2;
  // Without device geometry calibration, very short and inconsistent results are ambiguous.
  return Number.isFinite(metres) && metres >= .15 && metres <= MAX_METRES ? metres : undefined;
}

export class AcousticRanging {
  private active?: AbortController;

  constructor(private readonly audio: RangingAudio, private readonly show: (result: RangeResult) => void, private readonly clock: Clock = systemClock) {}

  cancel() {
    const active = this.active;
    if (active) {
      this.active = undefined;
      active.abort();
      this.show({status: 'unavailable'});
    }
  }

  async start(role: 'sender' | 'receiver', identity: RangeIdentity, whenIdle: (signal: AbortSignal) => Promise<void>) {
    this.cancel();
    const rate = this.audio.sampleRate;
    if (!this.audio.listening || !rate || rate < 8000 || rate > 96000) {
      this.show({status: 'unavailable'});
      return;
    }
    const operation = this.active = new AbortController();
    const {signal} = operation;
    const deadline = new AbortController();
    void this.clock.sleep(DEADLINE, deadline.signal).then(() => operation.abort()).catch(() => {});
    this.show({status: 'measuring'});
    const a = rangeProbe(rate, identity, false);
    const b = rangeProbe(rate, identity, true);
    let capture: ((pcm: Float32Array, startTime: number) => void) | undefined;
    let unsubscribe: (() => void) | undefined;

    const detect = (probe: Float32Array) => {
      const detector = new ProbeDetector(rate, probe);
      return new Promise<number>(resolve => {
        capture = (pcm, startTime) => {
          const match = detector.push(pcm, startTime);
          if (match !== undefined) { capture = undefined; resolve(match); }
        };
      });
    };
    const listen = (kind: Kind) => new Promise<number>(resolve => {
      unsubscribe?.();
      unsubscribe = this.audio.subscribe(bytes => {
        if (bytes[3] !== kind) return;
        try {
          const packet = decodePacket(bytes);
          if (packet.session === identity.session && packet.transfer === identity.transfer && packet.seq === 0) {
            resolve(new DataView(packet.payload.buffer, packet.payload.byteOffset, 4).getUint32(0));
          }
        } catch { /* Invalid ranging frames do not affect delivery. */ }
      });
    });
    const report = (kind: Kind, value: number) => {
      signal.throwIfAborted();
      const payload = new Uint8Array(4);
      new DataView(payload.buffer).setUint32(0, value);
      return this.audio.send(encodePacket({...identity, seq: 0, kind, payload}), signal, false);
    };
    const wait = async <T>(work: Promise<T>) => {
      if (signal.aborted) throw signal.reason;
      let cancel: () => void = () => {};
      try {
        return await Promise.race([work, new Promise<never>((_, reject) => {
          cancel = () => reject(signal.reason);
          signal.addEventListener('abort', cancel, {once: true});
        })]);
      } finally { signal.removeEventListener('abort', cancel); }
    };

    const readCapture = (pcm: Float32Array, time: number) => capture?.(pcm, time);
    this.audio.onRangeCapture = readCapture;
    try {
      await wait(whenIdle(signal));
      let metres: number | undefined;
      if (role === 'sender') {
        await this.clock.sleep(GUARD, signal);
        const own = detect(a);
        await this.audio.playRangeProbe(a, signal);
        const first = await wait(own);
        const peerTiming = listen(Kind.RANGE_TIMING);
        const second = await wait(detect(b));
        metres = distanceFromIntervals(second - first, await wait(peerTiming) / 1e6);
        if (metres !== undefined) {
          if (this.active === operation) this.show({status: 'estimated', metres});
          // Delivery and the local estimate are already available even if the peer misses this result.
          const millimetres = Math.round(metres * 1000);
          await this.clock.sleep(GUARD, signal).then(() => report(Kind.RANGE_RESULT, millimetres)).catch(() => {});
          return;
        }
      } else {
        const first = await wait(detect(a));
        await this.clock.sleep(GUARD, signal);
        const own = detect(b);
        await this.audio.playRangeProbe(b, signal);
        const interval = await wait(own) - first;
        if (interval <= 0 || interval > 2) throw new Error('Invalid reply interval.');
        const result = listen(Kind.RANGE_RESULT);
        await this.clock.sleep(GUARD, signal);
        await report(Kind.RANGE_TIMING, Math.round(interval * 1e6));
        const reported = await wait(result) / 1000;
        if (reported >= .15 && reported <= MAX_METRES) metres = reported;
      }
      if (this.active === operation) this.show(metres === undefined ? {status: 'unavailable'} : {status: 'estimated', metres});
    } catch {
      if (this.active === operation) this.show({status: 'unavailable'});
    } finally {
      deadline.abort();
      unsubscribe?.();
      if (this.audio.onRangeCapture === readCapture) this.audio.onRangeCapture = undefined;
      if (this.active === operation) this.active = undefined;
    }
  }
}
