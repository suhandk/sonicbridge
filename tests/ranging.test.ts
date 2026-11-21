import { expect, it } from 'vitest';
import { VirtualClock } from '../src/clock';
import { AcousticRanging, distanceFromIntervals, ProbeDetector, rangeProbe, type RangeResult } from '../src/ranging';

const identity = { session: 121, transfer: 84 };

it.each([44100, 48000])('finds a chirp crossing capture buffers at %i Hz', rate => {
  const probe = rangeProbe(rate, identity, false);
  const detector = new ProbeDetector(rate, probe);
  const start = 3685;
  const pcm = new Float32Array(8192);
  for (let i = 0; i < pcm.length; i++) pcm[i] = .005 * Math.sin(i * 2.72) + (probe[i - start] ?? 0) * .18;
  expect(detector.push(pcm.subarray(0, 4096), 0)).toBeUndefined();
  const detected = detector.push(pcm.subarray(4096), 4096 / rate);
  expect(Math.abs(detected! - start / rate)).toBeLessThan(.0005);
  expect(new ProbeDetector(rate, probe).push(new Float32Array(4096), 0)).toBeUndefined();
});

it('shares an acoustic estimate after both peers hear their own and the remote chirp', async () => {
  const clock = new VirtualClock();
  class Endpoint {
    peer!: Endpoint;
    listening = true;
    onRangeCapture?: (pcm: Float32Array, time: number) => void;
    receiver?: (bytes: Uint8Array) => void;
    constructor(readonly sampleRate: number, readonly offset: number) {}
    subscribe(receiver: (bytes: Uint8Array) => void) {
      this.receiver = receiver;
      return () => { this.receiver = undefined; };
    }
    async playRangeProbe(probe: Float32Array, signal: AbortSignal) {
      const emitted = clock.now() / 1000;
      for (const [endpoint, travel] of [[this, 0], [this.peer, 2 / 343]] as const) {
        const rate = endpoint.sampleRate;
        const pcm = new Float32Array(4096);
        for (let i = 0; i < Math.ceil(probe.length * rate / this.sampleRate); i++) {
          pcm[i] = probe[Math.floor(i * this.sampleRate / rate)];
        }
        endpoint.onRangeCapture?.(pcm, emitted + travel + endpoint.offset);
      }
      await clock.sleep(32, signal);
    }
    async send(bytes: Uint8Array, signal: AbortSignal) {
      await clock.sleep(1100, signal);
      this.peer.receiver?.(bytes);
    }
  }
  const a = new Endpoint(48000, 1), b = new Endpoint(44100, 7);
  a.peer = b; b.peer = a;
  const local: RangeResult[] = [], peer: RangeResult[] = [];
  const sender = new AcousticRanging(a, result => local.push(result), clock);
  const receiver = new AcousticRanging(b, result => peer.push(result), clock);
  await clock.drive(Promise.all([
    receiver.start('receiver', identity, async () => {}),
    sender.start('sender', identity, async () => {}),
  ]));
  for (const results of [local, peer]) {
    expect(results[0]).toEqual({ status: 'measuring' });
    const last = results.at(-1);
    expect(last?.status).toBe('estimated');
    if (last?.status === 'estimated') expect(Math.abs(last.metres - 2)).toBeLessThan(.1);
  }
  expect(a.onRangeCapture).toBeUndefined();
  expect(b.onRangeCapture).toBeUndefined();
});

it('rejects nonphysical timing and returns unavailable when there is no ranging peer', async () => {
  expect(distanceFromIntervals(.3, .4)).toBeUndefined();
  expect(distanceFromIntervals(.7, .4)).toBeUndefined();
  const clock = new VirtualClock();
  const statuses: RangeResult[] = [];
  const audio = {
    sampleRate: 48000, listening: true,
    playRangeProbe: async () => {},
    send: async () => { throw new Error('Must wait for peer measurements'); },
    subscribe: () => () => {},
  };
  await clock.drive(new AcousticRanging(audio, result => statuses.push(result), clock)
    .start('sender', identity, async () => {}));
  expect(statuses).toEqual([{status: 'measuring'}, {status: 'unavailable'}]);
});
