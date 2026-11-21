import { LinkController, ROBUST_EXTRA_GUARD, type ControllerSnapshot, type Policy } from './controller';
import { FIXED_MANIFEST, readManifestHeader, verifyContent, type VerifiedContent } from './content';
import { aborted, systemClock, type Clock } from './clock';
import { capsBytes, contentMask, crc32, decodePacket, encodePacket, equalBytes, finishBytes, Kind, MAX_CHUNKS, MAX_TRANSFER_BYTES, offerBytes, payloadCapacity, readCaps, readOffer, type Offer, type Packet } from './protocol';

export interface PacketChannel {
  readonly maxPacketBytes: number;
  /** Resolves after physical playback ends; abort must stop playback. No network fallback. */
  send(bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  subscribe(receive: (bytes: Uint8Array) => void): () => void;
}
export type TransportState = 'idle' | 'negotiating' | 'sending' | 'receiving' | 'received' | 'finishing' | 'completed' | 'cancelled' | 'failed';
export interface PacketEvent {
  at: number; direction: 'submit' | 'decode' | 'timeout'; kind: Kind; seq: number;
  session: number; transfer: number; attempt?: number;
}
export interface Events {
  packet?(event: PacketEvent): void;
  policy?(policy: Policy): void;
  replying?(busy: boolean): void;
  receiveStarted?(size?: number): void;
  reassembled?(stored: number, total: number, at: number): void;
  state?(state: TransportState, detail: string, at: number): void;
  deliver?(bytes: Uint8Array, identity: { session: number; transfer: number }): void;
  content?(item: VerifiedContent): void;
  controller?(snapshot: ControllerSnapshot): void;
  diagnostic?(detail: string): void;
}
export interface Timing { guardMs: number; ackTimeoutMs: number; attempts: number; backoffMs: number; rxIdleMs: number; retentionMs: number }
export const DEFAULT_TIMING: Timing = { guardMs: 500, ackTimeoutMs: 12000, attempts: 4, backoffMs: 1000, rxIdleMs: 120000, retentionMs: 600000 };
export const DEFAULT_DATA_ATTEMPTS = 8;
const MAX_TOMBSTONES = 32;
const empty = () => new Uint8Array();
const same = (a: { session: number; transfer: number }, b: { session: number; transfer: number }) => a.session === b.session && a.transfer === b.transfer;
const freshId = () => { let id = 0; while (!id) id = crypto.getRandomValues(new Uint32Array(1))[0]; return id; };
interface Incoming {
  session: number; transfer: number; offer: Offer; chunk: number; next: number;
  policy: Policy; policySeq: number; content: boolean; buffer: Uint8Array; timer?: AbortController;
}
interface Tombstone { session: number; transfer: number; until: number; completed: boolean; offer: Offer; chunk: number }
interface Outgoing { session: number; transfer: number; abort: AbortController }
interface Waiter { request: Packet; kind: Kind; accept: (p: Packet) => boolean; resolve: (p: Packet) => void }
class AckTimeout extends Error {}

export class StopAndWait {
  readonly controller: LinkController;
  private rejectedDuringWait = false;
  private txPolicy: Policy = 'Balanced';
  private incoming?: Incoming;
  private outgoing?: Outgoing;
  private waiter?: Waiter;
  private replyAbort?: AbortController;
  private tombstones: Tombstone[] = [];
  private disposed = false;
  private lifetime = new AbortController();
  private unsubscribe: () => void;
  readonly capacity: number;
  readonly timing: Timing;
  private readonly dataAttemptCap: number;
  get resources() { return { receiveBytes: this.incoming?.buffer.length ?? 0, tombstones: this.tombstones.length, sending: !!this.outgoing, replying: !!this.replyAbort }; }
  constructor(private channel: PacketChannel, private clock: Clock = systemClock, private events: Events = {}, private id = freshId, { dataAttemptCap, ...timing }: Partial<Timing> & { dataAttemptCap?: number } = {}) {
    this.controller = new LinkController(clock, events.controller);
    this.capacity = payloadCapacity(channel.maxPacketBytes);
    this.timing = { ...DEFAULT_TIMING, ...timing };
    const t = this.timing;
    this.dataAttemptCap = dataAttemptCap ?? DEFAULT_DATA_ATTEMPTS;
    if (!Number.isInteger(this.dataAttemptCap) || this.dataAttemptCap < 1 || this.dataAttemptCap > DEFAULT_DATA_ATTEMPTS) throw new Error('Invalid DATA attempt cap.');
    if (Object.values(t).some(n => !Number.isFinite(n) || n <= 0) || !Number.isInteger(t.attempts) || t.attempts > 8 || t.retentionMs < Math.max(t.attempts, this.dataAttemptCap) * (30000 + t.ackTimeoutMs + t.guardMs + ROBUST_EXTRA_GUARD + t.backoffMs * 16) || t.rxIdleMs <= t.ackTimeoutMs + t.backoffMs * 16 + (t.guardMs + ROBUST_EXTRA_GUARD) * 2 + 60000) throw new Error('Unsafe transport timing bounds.');
    this.unsubscribe = channel.subscribe(bytes => this.receive(bytes));
  }
  private state(state: TransportState, detail: string) { this.events.state?.(state, detail, this.clock.now()); }
  private prune() { this.tombstones = this.tombstones.filter(t => t.until > this.clock.now()); }
  private retire(rx: Incoming, completed: boolean) {
    rx.timer?.abort();
    this.incoming = undefined;
    // A slot was reserved before allocating incoming state; never evict a live tombstone.
    this.tombstones.push({ session: rx.session, transfer: rx.transfer, offer: rx.offer, chunk: rx.chunk, completed, until: this.clock.now() + this.timing.retentionMs });
  }
  private rejectContent(rx: Incoming, p: Packet, error: unknown) {
    this.retire(rx, false);
    this.reply({ ...p, kind: Kind.CANCEL, payload: empty() });
    this.state('failed', String(error));
  }
  private touch(rx: Incoming) {
    rx.timer?.abort();
    const timer = rx.timer = new AbortController();
    void this.clock.sleep(this.timing.rxIdleMs, timer.signal).then(() => {
      if (this.incoming === rx) { this.retire(rx, false); this.state('failed', 'Receiver timed out waiting for the next packet; partial transfer discarded.'); }
    }).catch(() => {});
  }
  private async transmit(p: Packet, signal: AbortSignal, extraGuard = 0, attempt?: number) {
    await this.clock.sleep(this.timing.guardMs + extraGuard, signal);
    if (signal.aborted) throw aborted(signal);
    const playback = new AbortController(), watchdog = new AbortController();
    const cancel = () => playback.abort(aborted(signal));
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const bytes = encodePacket(p, this.channel.maxPacketBytes);
      this.packet('submit', p, attempt);
      await Promise.race([
        this.channel.send(bytes, playback.signal),
        this.clock.sleep(30000, watchdog.signal).then(() => {
          const error = new Error('Acoustic playback exceeded 30 seconds; audio may be suspended.');
          playback.abort(error); throw error;
        }),
      ]);
    } finally { watchdog.abort(); signal.removeEventListener('abort', cancel); }
  }
  private packet(direction: PacketEvent['direction'], p: Packet, attempt?: number) {
    this.events.packet?.({ direction, at: this.clock.now(), kind: p.kind, session: p.session,
      transfer: p.transfer, seq: p.seq, attempt });
  }
  private reply(p: Packet, extraGuard = 0) {
    // Bounded one-packet reply slot. Concurrent duplicates are recovered by sender retries.
    if (this.replyAbort || this.disposed) return;
    const abort = this.replyAbort = new AbortController();
    this.events.replying?.(true);
    void this.transmit(p, abort.signal, extraGuard).catch(error => {
      if (!abort.signal.aborted) this.state('failed', `Acoustic ${Kind[p.kind]} playback failed: ${String(error)}`);
    }).finally(() => { if (this.replyAbort === abort) { this.replyAbort = undefined; if (!this.disposed) this.events.replying?.(false); } });
  }
  private receive(bytes: Uint8Array) {
    if (this.disposed) return;
    let p: Packet;
    try { p = decodePacket(bytes, this.channel.maxPacketBytes); }
    catch (error) {
      this.rejectedDuringWait = true; this.controller.decode(false);
      this.events.diagnostic?.(`Rejected acoustic packet: ${String(error)}`); return;
    }
    this.packet('decode', p);
    this.controller.decode(true);
    try {
      if (this.outgoing) {
        if (!same(p, this.outgoing)) return;
        if (p.kind === Kind.CANCEL) { this.outgoing.abort.abort(new Error('Peer cancelled the transfer.')); return; }
        const waiter = this.waiter;
        if (waiter && p.kind === waiter.kind && p.seq === waiter.request.seq && waiter.accept(p)) waiter.resolve(p);
        return; // Never interpret local loopback DATA/HELLO as a receive-side transfer.
      }
      this.prune();
      const old = this.tombstones.find(t => same(p, t));
      if (old) {
        if (old.completed && p.kind === Kind.FIN && p.seq === Math.ceil(old.offer.total / old.chunk) && equalBytes(p.payload, finishBytes(old.offer.total, old.offer.checksum))) this.reply({ ...p, kind: Kind.FIN_ACK });
        if (old.completed && (p.kind === Kind.DATA || p.kind === Kind.CONTENT_DATA_ALT) && p.seq < Math.ceil(old.offer.total / old.chunk) && p.payload.length === Math.min(old.chunk, old.offer.total - p.seq * old.chunk)) this.reply({ ...p, kind: Kind.ACK, payload: empty() });
        return; // Retired HELLO never reopens a completed/cancelled/expired session.
      }
      let rx = this.incoming;
      if (p.kind === Kind.HELLO || p.kind === Kind.CONTENT_HELLO) {
        const content = p.kind === Kind.CONTENT_HELLO;
        if (content && !this.events.content) return;
        const offer = readOffer(p.payload); // Resource bounds verified before allocation.
        if (content && offer.total < FIXED_MANIFEST + 1) return;
        if (rx) {
          if (rx.content !== content || !same(p, rx) || !equalBytes(p.payload, offerBytes(rx.offer))) return;
        } else {
          if (this.replyAbort || this.tombstones.length >= MAX_TOMBSTONES) return;
          const chunk = Math.min(offer.chunk, this.capacity);
          if (Math.ceil(offer.total / chunk) > MAX_CHUNKS) return;
          rx = this.incoming = { session: p.session, transfer: p.transfer, offer, content, policy: 'Balanced', policySeq: -1, chunk, next: 0, buffer: new Uint8Array(offer.total) };
          this.events.receiveStarted?.(content ? undefined : offer.total);
        }
        this.touch(rx);
        this.reply({ ...p, kind: content ? Kind.CONTENT_CAPS : Kind.CAPS, payload: capsBytes(rx.chunk, Math.min(MAX_TRANSFER_BYTES, offer.maxTransfer)) });
        this.state('receiving', `Negotiated ${rx.chunk}-byte DATA chunks; receiving ${offer.total} bytes.`);
        return;
      }
      if (!rx || !same(p, rx)) return;
      if (p.kind === Kind.CANCEL) { this.retire(rx, false); this.state('cancelled', 'Peer cancelled; partial transfer discarded.'); return; }
      const chunks = Math.ceil(rx.offer.total / rx.chunk);
      if (p.kind === Kind.SET_POLICY && rx.content) {
        // Permit negotiation on a lost ACK for the preceding, already stored DATA.
        if (p.seq >= chunks || p.seq < rx.next - 1 || p.seq > rx.next || p.seq < rx.policySeq || p.payload[0] > 1) return;
        const policy: Policy = p.payload[0] ? 'Robust' : 'Balanced';
        if (p.seq === rx.policySeq && policy !== rx.policy) return;
        if (rx.policy !== policy) this.controller.log(`Peer requested ${policy} ACK pacing at DATA ${p.seq}.`);
        rx.policy = policy; this.events.policy?.(policy); rx.policySeq = p.seq; this.touch(rx);
        this.reply({ ...p, kind: Kind.POLICY_ACK }); return;
      }
      if (p.kind === Kind.DATA || (rx.content && p.kind === Kind.CONTENT_DATA_ALT)) {
        if (rx.content) p.payload = contentMask(p);
        const offset = p.seq * rx.chunk, expected = Math.min(rx.chunk, rx.offer.total - offset);
        if (p.seq > rx.next || p.seq >= chunks || p.payload.length !== expected) return;
        if (p.seq < rx.next) {
          if (!equalBytes(p.payload, rx.buffer.subarray(offset, offset + expected))) return;
        } else {
          rx.buffer.set(p.payload, offset);
          if (rx.content && offset < 5 && offset + expected >= 5) {
            try { readManifestHeader(rx.buffer, rx.offer.total); }
            catch (error) { this.rejectContent(rx, p, error); return; }
          }
          rx.next++;
          const length = offset + expected;
          if (!rx.content || length >= 5) {
            const overhead = rx.content ? FIXED_MANIFEST + rx.buffer[4] : 0;
            this.events.reassembled?.(Math.max(0, length - overhead), rx.offer.total - overhead, this.clock.now());
          }
        }
        this.touch(rx);
        this.reply({ ...p, kind: Kind.ACK, payload: empty() }, rx.policy === 'Robust' ? ROBUST_EXTRA_GUARD : 0);
        return;
      }
      if (p.kind === Kind.FIN && p.seq === chunks && rx.next === chunks && equalBytes(p.payload, finishBytes(rx.offer.total, rx.offer.checksum))) {
        if (crc32(rx.buffer) !== rx.offer.checksum) throw new Error('Transfer CRC32 mismatch; completion refused.');
        let item: VerifiedContent | undefined;
        if (rx.content) {
          try { item = verifyContent(rx.buffer); }
          catch (error) {
            this.rejectContent(rx, p, error);
            return;
          }
        }
        this.retire(rx, true);
        this.reply({ ...p, kind: Kind.FIN_ACK });
        if (item) this.events.content?.(item);
        else this.events.deliver?.(rx.buffer, { session: rx.session, transfer: rx.transfer });
        this.state('received', 'Receiver verified length and transfer CRC32. Acoustic FIN_ACK queued; sender confirmation may still be pending.');
      }
    } catch (error) { this.events.diagnostic?.(`Rejected acoustic packet: ${String(error)}`); }
  }
  private async exchange(request: Packet, response: Kind, accept: (p: Packet) => boolean, signal: AbortSignal, whiten = false): Promise<Packet> {
    for (let attempt = 1; ; attempt++) {
      if (whiten && this.controller.target !== this.txPolicy) {
        const target = this.controller.target;
        const payload = Uint8Array.of(target === 'Robust' ? 1 : 0);
        try {
          await this.exchange({ ...request, kind: Kind.SET_POLICY, payload }, Kind.POLICY_ACK, p => equalBytes(p.payload, payload), signal);
        } catch (error) {
          this.controller.negotiationFailed(`Unconfirmed ${target} at DATA ${request.seq}; ending transfer. Next HELLO starts Balanced.`); throw error;
        }
        this.txPolicy = target; this.events.policy?.(target);
        this.controller.log(`Peer confirmed ${target} for DATA ${request.seq} (session ${request.session}).`);
      }
      const robust = whiten && this.txPolicy === 'Robust';
      const limit = request.kind === Kind.SET_POLICY ? 2 : request.kind === Kind.DATA
        ? this.dataAttemptCap : this.timing.attempts;
      const timer = new AbortController();
      const cancel = () => timer.abort(aborted(signal));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      try {
        const received = new Promise<Packet>(resolve => { this.waiter = { request, kind: response, accept, resolve }; });
        this.events.diagnostic?.(`${Kind[request.kind]} seq ${request.seq}, attempt ${attempt}/${limit}`);
        let wire = request;
        if (whiten) {
          wire = { ...request, kind: attempt % 2 ? Kind.DATA : Kind.CONTENT_DATA_ALT };
          wire.payload = contentMask(wire);
        }
        this.rejectedDuringWait = false;
        await this.transmit(wire, signal, robust ? ROBUST_EXTRA_GUARD : 0, attempt);
        // Start timeout only after our waveform finishes; receive was armed before playback.
        const result = await Promise.race([received, this.clock.sleep(this.timing.ackTimeoutMs, timer.signal).then(() => { throw new AckTimeout(`${Kind[response]} timed out`); })]);
        if (whiten) this.controller.outcome(true, attempt > 1, this.rejectedDuringWait);
        return result;
      } catch (error) {
        if (signal.aborted) throw aborted(signal);
        if (!(error instanceof AckTimeout)) throw error;
        this.packet('timeout', request, attempt);
        if (whiten) this.controller.outcome(false, attempt > 1, this.rejectedDuringWait);
        if (attempt >= limit) throw new Error(`${Kind[response]} timed out after ${attempt} attempts. Delivery unconfirmed; receiver may have completed.`);
      } finally { this.waiter = undefined; timer.abort(); signal.removeEventListener('abort', cancel); }
      const jitter = this.clock.random();
      if (jitter < 0 || jitter >= 1) throw new Error('Clock random() must be in [0, 1).');
      await this.clock.sleep(this.timing.backoffMs * Math.min(8, 2 ** (attempt - 1)) * (1 + jitter), signal);
    }
  }
  async send(data: Uint8Array, options: { content?: boolean; acknowledged?: (bodyBytes: number, chunk: number, at: number) => void } = {}): Promise<void> {
    if (this.disposed) throw new Error('Transport is closed.');
    if (this.outgoing || this.incoming || this.replyAbort) throw new Error('Acoustic link busy; finish the current transfer first.');
    if (!data.length || data.length > MAX_TRANSFER_BYTES) throw new Error(`Transfer must contain 1–${MAX_TRANSFER_BYTES} bytes.`);
    const owned = Uint8Array.from(data), checksum = crc32(owned);
    this.txPolicy = 'Balanced';
    const started = this.clock.now();
    let confirmedBytes = 0;
    const tx = this.outgoing = { session: this.id(), transfer: this.id(), abort: new AbortController() };
    const packet = (kind: Kind, seq: number, payload = empty()): Packet => ({ kind, seq, session: tx.session, transfer: tx.transfer, payload });
    try {
      this.state('negotiating', 'Sending acoustic HELLO; waiting for capabilities.');
      const caps = await this.exchange(packet(options.content ? Kind.CONTENT_HELLO : Kind.HELLO, 0, offerBytes({ total: owned.length, checksum, chunk: this.capacity, maxTransfer: MAX_TRANSFER_BYTES })), options.content ? Kind.CONTENT_CAPS : Kind.CAPS, p => {
        const c = readCaps(p.payload); return c.chunk <= this.capacity && c.maxTransfer >= owned.length && Math.ceil(owned.length / c.chunk) <= MAX_CHUNKS;
      }, tx.abort.signal);
      const { chunk } = readCaps(caps.payload), chunks = Math.ceil(owned.length / chunk);
      for (let seq = 0; seq < chunks; seq++) {
        this.state('sending', `Sending DATA ${seq + 1}/${chunks}; waiting for its acoustic ACK.`);
        await this.exchange(packet(Kind.DATA, seq, owned.subarray(seq * chunk, Math.min(owned.length, (seq + 1) * chunk))), Kind.ACK, () => true, tx.abort.signal, options.content);
        options.acknowledged?.(Math.min(owned.length, (seq + 1) * chunk), chunk, this.clock.now());
      }
      const finish = finishBytes(owned.length, checksum);
      this.state('finishing', 'Waiting for receiver-verified completion (FIN_ACK).');
      await this.exchange(packet(Kind.FIN, chunks, finish), Kind.FIN_ACK, p => equalBytes(p.payload, finish), tx.abort.signal);
      if (tx.abort.signal.aborted) throw aborted(tx.abort.signal);
      if (options.content) confirmedBytes = owned.length - FIXED_MANIFEST - owned[4];
      this.state('completed', 'Transfer confirmed: receiver verified all bytes and its acoustic FIN_ACK arrived.');
    } catch (error) {
      this.state(tx.abort.signal.aborted ? 'cancelled' : 'failed', String(error));
      // Best effort cancellation is itself acoustic and bounded to one transmission.
      if (!this.disposed) { try { await this.transmit(packet(Kind.CANCEL, 0), this.lifetime.signal); } catch { /* Original failure remains the terminal reason. */ } }
      throw error;
    } finally { if (options.content && !this.disposed) this.controller.finish(confirmedBytes, this.clock.now() - started); if (this.outgoing === tx) this.outgoing = undefined; this.waiter = undefined; }
  }
  cancel() {
    this.outgoing?.abort.abort(new Error('Transfer cancelled locally. Delivery unconfirmed.'));
    if (this.incoming) {
      const rx = this.incoming; this.retire(rx, false);
      this.replyAbort?.abort(); this.replyAbort = undefined;
      this.reply({ kind: Kind.CANCEL, session: rx.session, transfer: rx.transfer, seq: 0, payload: empty() });
      this.state('cancelled', 'Receive cancelled locally; partial transfer discarded.');
    }
  }
  async whenIdle(signal: AbortSignal = this.lifetime.signal) {
    const deadline = this.clock.now() + 45000;
    while (this.outgoing || this.incoming || this.replyAbort) {
      if (this.disposed || signal.aborted) throw new Error('Audio transport stopped while waiting for turnaround.');
      if (this.clock.now() >= deadline) throw new Error('Acoustic channel did not become idle for calibration.');
      await this.clock.sleep(100, signal);
    }
    if (this.disposed || signal.aborted) throw new Error('Audio transport stopped.');
  }
  dispose() {
    this.disposed = true; this.unsubscribe(); this.lifetime.abort(); this.outgoing?.abort.abort(new Error('Audio transport stopped.'));
    this.replyAbort?.abort(); this.incoming?.timer?.abort(); this.incoming = undefined; this.tombstones = [];
  }
}
