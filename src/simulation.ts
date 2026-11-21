import type { OperatingMode, ControllerSnapshot } from './controller';
import { VirtualClock, type Clock } from './clock';
import { createModem, decodeBinaryFixture, type AudibleProfile, type Modem, type ModemFactory } from './modem';
import { StopAndWait, type Events, type PacketChannel } from './transport';

/** Ideal PCM channel. This never calls getUserMedia, plays sound, or uses a network. */
export class PcmChannel implements PacketChannel {
  peer?: PcmChannel;
  private receivers = new Set<(bytes: Uint8Array) => void>();
  private transmitting = false;
  get maxPacketBytes() { return this.modem.maxMessageBytes; }
  constructor(private modem: Modem, private clock: Clock, private waveform?: (pcm: Float32Array, rate: number) => void, private profile?: AudibleProfile) {}
  subscribe(receive: (bytes: Uint8Array) => void) { this.receivers.add(receive); return () => { this.receivers.delete(receive); }; }
  async send(bytes: Uint8Array, signal: AbortSignal) {
    if (this.transmitting) throw new Error('Overlapping PCM transmissions.');
    this.transmitting = true;
    try {
      this.modem.reset();
      const pcm = this.modem.encodeBytes(bytes, this.profile);
      this.waveform?.(pcm, this.modem.sampleRate);
      await this.clock.sleep(pcm.length / this.modem.sampleRate * 1000, signal);
      const peer = this.peer;
      if (peer && !peer.transmitting) {
        const received = decodeBinaryFixture(peer.modem, pcm);
        received.forEach(packet => peer.receivers.forEach(receive => receive(packet)));
      }
    } finally { this.transmitting = false; this.modem.reset(); }
  }
  dispose() { this.receivers.clear(); this.modem.dispose(); }
}
export async function simulateTransfer(data: Uint8Array, options: { monitor?: Pick<Events, 'packet' | 'state' | 'policy'>; mode?: OperatingMode; profile?: AudibleProfile; controller?: (snapshot: ControllerSnapshot) => void; sendOptions?: Parameters<StopAndWait['send']>[1]; content?: import('./transport').Events['content']; factory?: ModemFactory; signal?: AbortSignal; waveform?: (pcm: Float32Array, rate: number) => void } = {}) {
  const clock = new VirtualClock(41);
  const a = new PcmChannel(await createModem(48000, options.factory), clock, options.waveform, options.profile);
  let b: PcmChannel | undefined, tx: StopAndWait | undefined, rx: StopAndWait | undefined;
  try {
    b = new PcmChannel(await createModem(48000, options.factory), clock);
    a.peer = b; b.peer = a;
    const delivered: Uint8Array[] = [];
    tx = new StopAndWait(a, clock, { ...options.monitor, controller: options.controller }, (() => { let n = 40; return () => ++n; })());
    tx.controller.select(options.mode ?? 'Balanced');
    rx = new StopAndWait(b, clock, { content: options.content, deliver: bytes => delivered.push(bytes) });
    const cancel = () => tx!.cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (options.signal?.aborted) throw options.signal.reason;
      await clock.drive(tx.send(data, options.sendOptions), !!options.signal);
      return delivered;
    } finally { options.signal?.removeEventListener('abort', cancel); }
  } finally { tx?.dispose(); rx?.dispose(); a.dispose(); b?.dispose(); }
}
