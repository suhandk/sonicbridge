import type { Clock } from '../src/clock';
import type { Modem } from '../src/modem';
import type { PacketChannel } from '../src/transport';

export type Trace = 'quiet' | 'noise burst' | 'weak return';
export const seeds = [41, 73, 109, 151] as const;
export const traces: Trace[] = ['quiet', 'noise burst', 'weak return'];

// Counter-based noise: the same instant on a directional capture clock always has the same sample.
export function noise(index: number, seed: number) {
  let h = Math.imul(index ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 0x80000000 - 1;
}
export function path(seed: number, reverse: boolean) {
  const key = seed ^ (reverse ? 0x319c78b1 : 0x73fb1221);
  return { key, gain: 0.50 + 0.18 * noise(1,key), delayMs: 16 + 7*noise(2,key),
    ppm: 100*noise(3,key), echo1: 0.18 + 0.06*noise(4,key), echo2: -0.09 + 0.03*noise(5,key) };
}
// Render one bounded playback and its tail onto the receiver's actual sampling grid.
export function capture(pcm: Float32Array, txRate: number, rxRate: number, startMs: number, seed: number, reverse: boolean, trace: Trace) {
  if (![44100,48000].includes(txRate) || ![44100,48000].includes(rxRate) || !pcm.length || pcm.length > txRate*30)
    throw new Error('Benchmark waveform outside allowed rates or duration.');
  const p = path(seed, reverse), rate = rxRate*(1+p.ppm/1e6);
  const first = Math.ceil(startMs*rate/1000);
  const length = Math.ceil((pcm.length/txRate + p.delayMs/1000 + 0.027 + 0.35)*rate);
  const dry = new Float32Array(length), captured = new Float32Array(length);
  const step = txRate/rate, origin = (first/rate - startMs/1000 - p.delayMs/1000)*txRate;
  for (let i=0; i<length; i++) {
    const pos = origin + i*step, j = Math.floor(pos);
    if (j >= 0 && j < pcm.length) dry[i] = pcm[j] + ((pcm[j+1] ?? 0)-pcm[j])*(pos-j);
  }
  const tap1 = Math.round(rate*0.009), tap2 = Math.round(rate*0.027);
  for (let i=0; i<length; i++) {
    const ms = (first+i)*1000/rate;
    const burst = trace === 'noise burst' && ms >= 18000 && ms < 56000;
    const weak = reverse && trace === 'weak return';
    const signal = dry[i] + p.echo1*(dry[i-tap1] ?? 0) + p.echo2*(dry[i-tap2] ?? 0);
    const gain = p.gain*(weak ? 0.13 : 1);
    const amplitude = burst ? 0.75 : weak ? 0.13 : 0.008;
    captured[i] = Math.max(-1, Math.min(1, signal*gain + amplitude*noise(first+i,p.key)));
  }
  return { pcm: captured, durationMs: length*1000/rate };
}

export class AudioPath implements PacketChannel {
  get maxPacketBytes() { return this.modem.maxMessageBytes; }
  peer!: AudioPath;
  private receive?: (bytes: Uint8Array) => void;
  private lifetime = new AbortController();
  private transmitting = false;
  constructor(private modem: Modem, private clock: Clock, private seed: number, private reverse: boolean, private trace: Trace) {}
  subscribe(fn: (bytes: Uint8Array) => void) { this.receive = fn; return () => { this.receive = undefined; }; }
  async send(bytes: Uint8Array, signal: AbortSignal) {
    if (this.transmitting || this.peer.transmitting) throw new Error('Unexpected overlapping half-duplex playback');
    this.transmitting = true;
    try {
      this.modem.reset();
      const wave = this.modem.encodeBytes(bytes), playbackMs = wave.length*1000/this.modem.sampleRate;
      const frame = capture(wave, this.modem.sampleRate, this.peer.modem.sampleRate, this.clock.now(), this.seed, this.reverse, this.trace);
      await this.clock.sleep(playbackMs, signal);
      // Playback ends locally first. Detection is reported conservatively at the end of the capture window.
      void this.clock.sleep(frame.durationMs-playbackMs, this.lifetime.signal).then(() => {
        if (this.peer.transmitting) return;
        for (const packet of this.peer.modem.decodeBytes(frame.pcm)) this.peer.receive?.(packet);
      }, () => {});
    } finally { this.transmitting = false; }
  }
  dispose() { this.lifetime.abort(); this.receive = undefined; this.modem.dispose(); }
}
