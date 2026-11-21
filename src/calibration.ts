import { systemClock, type Clock } from './clock';
import { equalBytes } from './protocol';
export interface CalibrationMetrics { sampleRate: number; rms: number; peak: number; flags: number }
interface CalibrationLink { send(bytes: Uint8Array): Promise<void>; whenIdle(signal: AbortSignal): Promise<void>; cancel(): void }
const magic = [0xff, 0x53, 0x42, 0x43]; // Cannot collide with a valid UTF-8 text body.
export function calibrationBody(nonce: Uint8Array, metrics?: CalibrationMetrics) {
  if (nonce.length !== 8) throw new Error('Calibration nonce must be eight bytes.');
  const bytes = new Uint8Array(metrics ? 23 : 14), v = new DataView(bytes.buffer);
  bytes.set(magic); bytes[4] = 1; bytes[5] = metrics ? 2 : 1; bytes.set(nonce, 6);
  if (metrics) { v.setUint32(14, metrics.sampleRate); v.setUint16(18, Math.round(Math.max(0, Math.min(1, metrics.rms)) * 65535)); v.setUint16(20, Math.round(Math.max(0, Math.min(1, metrics.peak)) * 65535)); bytes[22] = metrics.flags; }
  return bytes;
}
export function parseCalibration(bytes: Uint8Array) {
  if (!magic.every((byte, i) => bytes[i] === byte)) return undefined;
  if (bytes[4] !== 1 || !((bytes[5] === 1 && bytes.length === 14) || (bytes[5] === 2 && bytes.length === 23))) throw new Error('Unsupported calibration body.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const metrics = bytes[5] === 2 ? { sampleRate: v.getUint32(14), rms: v.getUint16(18) / 65535, peak: v.getUint16(20) / 65535, flags: bytes[22] } : undefined;
  if (metrics && (metrics.sampleRate < 8000 || metrics.sampleRate > 96000 || metrics.flags > 15)) throw new Error('Invalid calibration metrics.');
  return { nonce: bytes.subarray(6, 14), metrics };
}
export class Calibration {
  private armed = false;
  private disposed = false;
  private active?: AbortController;
  private pending?: { nonce: Uint8Array; resolve: (metrics: CalibrationMetrics) => void };
  constructor(private link: CalibrationLink, private metrics: () => CalibrationMetrics, private status: (detail: string, armed: boolean) => void, private clock: Clock = systemClock, private nonce = () => crypto.getRandomValues(new Uint8Array(8))) {}
  arm() {
    if (this.disposed || this.active) throw new Error('Calibration is busy or stopped.');
    this.armed = true; this.status('Receiver armed for one calibration. On the other device tap Calibrate link. Keep both screens awake.', true);
  }
  handle(bytes: Uint8Array): boolean {
    const message = parseCalibration(bytes); if (!message) return false;
    if (this.disposed) return true;
    if (message.metrics) {
      if (this.pending && equalBytes(message.nonce, this.pending.nonce)) this.pending.resolve(message.metrics);
    } else if (this.armed && !this.active) {
      this.armed = false; const abort = this.active = new AbortController();
      this.status('Calibration request verified. Waiting for FIN_ACK turnaround before replying through the speaker.', false);
      const reply = calibrationBody(message.nonce, this.metrics());
      void this.link.whenIdle(abort.signal).then(() => this.link.send(reply)).then(() => {
        if (!this.disposed && !abort.signal.aborted) this.status('Calibration reply acknowledged by the initiator. This receiver is no longer armed.', false);
      }).catch(error => { if (!this.disposed) this.status(`Calibration response failed: ${String(error)}`, false); }).finally(() => { if (this.active === abort) this.active = undefined; });
    } else this.status('Calibration request received but receiver is not armed. Tap Arm calibration receiver before retrying.', this.armed);
    return true;
  }
  async run(): Promise<CalibrationMetrics> {
    if (this.disposed || this.active) throw new Error('Calibration already active or stopped.');
    const abort = this.active = new AbortController(); this.armed = false;
    const nonce = this.nonce();
    const result = new Promise<CalibrationMetrics>(resolve => { this.pending = { nonce, resolve }; });
    const timer = new AbortController(), cancel = () => timer.abort(abort.signal.reason);
    abort.signal.addEventListener('abort', cancel, { once: true });
    try {
      this.status('Sending calibration challenge. The other device must be armed; keep both screens awake.', false);
      await this.link.send(calibrationBody(nonce));
      this.status('Challenge acknowledged. Waiting for the peer’s acoustic challenge reply (up to 180 seconds).', false);
      const metrics = await Promise.race([result, this.clock.sleep(180000, timer.signal).then(() => { throw new Error('Calibration reply timed out. Arm the other device and check both speaker/microphone routes.'); })]);
      if (abort.signal.aborted) throw new Error('Calibration cancelled.');
      await this.link.whenIdle(abort.signal); // Finish the response transfer's FIN_ACK playback.
      this.status(`Bidirectional calibration challenge verified. Peer graph ${metrics.sampleRate} Hz, RMS ${metrics.rms.toFixed(3)}, peak ${metrics.peak.toFixed(3)}, flags ${metrics.flags}. Repeat after any route change.`, false);
      return metrics;
    } catch (error) { if (!this.disposed) this.status(`Calibration not confirmed: ${String(error)}`, false); throw error; }
    finally { timer.abort(); abort.signal.removeEventListener('abort', cancel); this.pending = undefined; if (this.active === abort) this.active = undefined; }
  }
  cancel() { this.armed = false; this.active?.abort(new Error('Calibration cancelled.')); this.link.cancel(); if (!this.disposed) this.status('Calibration cancelled; receiver disarmed.', false); }
  dispose() { this.disposed = true; this.cancel(); }
}
