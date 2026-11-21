import type { Clock } from './clock';

export type OperatingMode = 'Balanced' | 'Robust' | 'Adaptive';
export type Policy = Exclude<OperatingMode, 'Adaptive'>;
export const ROBUST_EXTRA_GUARD = 400;
type Outcome = { ack: boolean; retry: boolean; rejected: boolean };
type Result = { bytes: number; ms: number };
export type ControllerSnapshot = ReturnType<LinkController['snapshot']>;

export class LinkController {
  mode: OperatingMode = 'Balanced';
  target: Policy = 'Balanced';
  private since: number;
  private readonly origin: number;
  private evidence = 0;
  private outcomes: Outcome[] = [];
  private decodes: boolean[] = [];
  private transfers: Result[] = [];
  private history: string[] = [];
  constructor(private clock: Clock, private publish?: (snapshot: ControllerSnapshot) => void) {
    this.origin = this.since = clock.now();
  }
  snapshot() {
    const ms = this.transfers.reduce((sum, t) => sum + t.ms, 0);
    return { mode: this.mode, target: this.target, attempts: this.outcomes.length,
      acks: this.outcomes.filter(o => o.ack).length, retries: this.outcomes.filter(o => o.retry).length,
      decoded: this.decodes.filter(Boolean).length, rejected: this.decodes.filter(ok => !ok).length,
      confirmedBps: ms ? this.transfers.reduce((sum, t) => sum + t.bytes, 0) * 1000 / ms : undefined,
      history: [...this.history] };
  }
  private update() { this.publish?.(this.snapshot()); }
  log(reason: string) {
    this.history = [...this.history, `+${((this.clock.now() - this.origin)/1000).toFixed(1)} s · ${reason}`].slice(-20);
    this.update();
  }
  select(mode: OperatingMode) {
    if (this.mode === mode) return;
    this.mode = mode; this.target = mode === 'Robust' ? 'Robust' : 'Balanced';
    this.since = this.clock.now(); this.evidence = 0;
    this.log(`Selected ${mode}; requested pacing ${this.target}.`);
  }
  negotiationFailed(detail: string) {
    if (this.mode === 'Adaptive') {
      this.target = 'Balanced'; this.evidence = 0; this.since = this.clock.now();
      this.log(detail + ' Adaptive will retry from Balanced on the next transfer.');
    } else this.log(detail);
  }
  decode(valid: boolean) { this.decodes = [...this.decodes, valid].slice(-16); this.update(); }
  finish(bytes: number, elapsed: number) {
    this.transfers = [...this.transfers, { bytes, ms: elapsed }].slice(-4); this.update();
  }
  outcome(ack: boolean, retry: boolean, rejected: boolean) {
    this.outcomes = [...this.outcomes, { ack, retry, rejected }].slice(-8);
    this.evidence = Math.min(8, this.evidence + 1);
    const recent = this.outcomes.slice(-Math.min(4, this.evidence)), misses = recent.filter(x => !x.ack).length;
    const lastTwo = recent.slice(-2);
    const dwell = this.clock.now() - this.since;
    let reason = '';
    if (this.mode === 'Adaptive' && this.target === 'Balanced') {
      if (lastTwo.length === 2 && lastTwo.every(x => !x.ack)) reason = 'two consecutive DATA ACK timeouts (fast fallback)';
      else if (dwell >= 10000 && misses >= 2) reason = `${misses} timeouts in the latest ${recent.length} DATA attempts`;
      else if (dwell >= 10000 && !ack && rejected) reason = 'DATA ACK timeout with a rejected modem output during the wait';
      if (reason) this.target = 'Robust';
    } else if (this.mode === 'Adaptive' && this.target === 'Robust' && dwell >= 30000 &&
        this.evidence === 8 && this.outcomes.every(o => o.ack && !o.retry && !o.rejected)) {
      this.target = 'Balanced'; reason = 'eight clean first-attempt DATA ACKs and at least 30 s in Robust';
    }
    if (reason) {
      this.since = this.clock.now();
      this.log(`Request ${this.target}: ${reason}.`);
    } else this.update();
  }
}
