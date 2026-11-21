import { packContent, manifestSize, type VerifiedContent } from '../src/content';
import { expect, it } from 'vitest';
import { VirtualClock } from '../src/clock';
import { crc32, decodePacket, encodePacket, finishBytes, Kind, offerBytes, type Packet } from '../src/protocol';
import { StopAndWait, type PacketChannel } from '../src/transport';

type Fault = (p: Packet, side: number, occurrence: number, bytes: Uint8Array) => { drop?: boolean; delay?: number; copies?: number; replace?: Uint8Array } | undefined;
class Wire implements PacketChannel {
  peer!: Wire;
  receiver?: (bytes: Uint8Array) => void;
  maxPacketBytes = 140;
  log: Packet[] = [];
  private counts = new Map<string, number>();
  private lifetime = new AbortController();
  private transmitting = false;
  constructor(private clock: VirtualClock, private side: number, private fault: Fault) {}
  subscribe(receive: (bytes: Uint8Array) => void) { this.receiver = receive; return () => { this.receiver = undefined; }; }
  inject(bytes: Uint8Array) { this.receiver?.(bytes); }
  async send(bytes: Uint8Array, signal: AbortSignal) {
    expect(this.transmitting).toBe(false); this.transmitting = true;
    const p = decodePacket(bytes); this.log.push(p);
    const key = `${p.kind}/${p.seq}/${p.session}`;
    const n = (this.counts.get(key) ?? 0) + 1; this.counts.set(key, n);
    try {
      await this.clock.sleep(100, signal);
      const action = this.fault(p, this.side, n, bytes) ?? {};
      if (!action.drop) for (let i = 0; i < (action.copies ?? 1); i++) {
        const received = Uint8Array.from(action.replace ?? bytes);
        void this.clock.sleep((action.delay ?? 0) + i * 5, this.lifetime.signal).then(() => { if (!this.peer.transmitting) this.peer.inject(received); }).catch(() => {});
      }
    } finally { this.transmitting = false; }
  }
  close() { this.lifetime.abort(); }
}
function setup(fault: Fault = () => undefined) {
  const clock = new VirtualClock(41), a = new Wire(clock, 0, fault), b = new Wire(clock, 1, fault);
  a.peer = b; b.peer = a;
  const delivered: Uint8Array[] = [], states: string[] = [], diagnostics: string[] = [];
  const content: VerifiedContent[] = [];
  const selfDelivered: Uint8Array[] = [];
  let id = 40;
  const tx = new StopAndWait(a, clock, { state: (s, d) => states.push(`${s}: ${d}`), diagnostic: d => diagnostics.push(d), deliver: bytes => selfDelivered.push(bytes) }, () => ++id);
  const rx = new StopAndWait(b, clock, { content: item => content.push(item), state: (state, detail) => states.push('rx '+state+': '+detail), deliver: bytes => delivered.push(bytes), diagnostic: d => diagnostics.push(d) });
  return { clock, a, b, tx, rx, content, delivered, selfDelivered, states, diagnostics, close() { tx.dispose(); rx.dispose(); a.close(); b.close(); } };
}
const data = Uint8Array.from({ length: 301 }, (_, i) => (i * 19) & 255);
it('retries a lost short-text receipt and delivers the verified text exactly once', async () => {
  const s = setup((p, _side, n) => p.kind === Kind.FIN_ACK && n === 1 ? { drop: true } : undefined);
  const message = 'Sonic 🌉';
  const body = packContent('text', 'message.txt', new TextEncoder().encode(message));
  try {
    await s.clock.drive(s.tx.send(body, { shortText: true }));
    expect(s.a.log.map(p => p.kind)).toEqual([Kind.SHORT_TEXT, Kind.SHORT_TEXT]);
    expect(s.b.log.map(p => p.kind)).toEqual([Kind.FIN_ACK, Kind.FIN_ACK]);
    expect(s.content.map(item => item.text)).toEqual([message]);
    expect(s.states.at(-1)).toContain('completed: Short text confirmed');
  } finally { s.close(); }
});
it('does not return a short-text receipt when the packet CRC passes but SHA-256 fails', async () => {
  const s = setup(p => {
    if (p.kind !== Kind.SHORT_TEXT) return;
    const payload = p.payload.slice();
    payload[payload.length - 1] ^= 1;
    return { replace: encodePacket({ ...p, payload }) };
  });
  try {
    const body = packContent('text', 'message.txt', Uint8Array.of(65));
    await expect(s.clock.drive(s.tx.send(body, { shortText: true }))).rejects.toThrow('FIN_ACK timed out');
    expect(s.diagnostics).toContain('Rejected acoustic packet: Error: Whole-file SHA-256 mismatch.');
    expect(s.b.log).toHaveLength(0);
    expect(s.content).toHaveLength(0);
  } finally { s.close(); }
});
for (const loss of [Kind.HELLO, Kind.CAPS, Kind.DATA, Kind.ACK, Kind.FIN, Kind.FIN_ACK]) {
  it(`recovers a lost ${Kind[loss]} without duplicate delivery`, async () => {
    const s = setup((p, _side, n) => p.kind === loss && n === 1 ? { drop: true } : undefined);
    try {
      await s.clock.drive(s.tx.send(data));
      expect(s.delivered).toEqual([data]); expect(s.states.at(-1)).toContain('completed: Transfer confirmed');
      expect([...s.a.log, ...s.b.log].filter(p => p.kind === loss).length).toBeGreaterThan(1);
    } finally { s.close(); }
  });
}
it('negotiates the smaller actual decoded packet limit and sends only that DATA size', async () => {
  const s = setup(); s.b.maxPacketBytes = 80;
  // Capacity is fixed at construction, so replace the receiver after changing the adapter limit.
  s.rx.dispose();
  const rx = new StopAndWait(s.b, s.clock, { deliver: bytes => s.delivered.push(bytes) });
  try { await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]); expect(s.a.log.filter(p => p.kind === Kind.DATA).every(p => p.payload.length <= 60)).toBe(true); }
  finally { rx.dispose(); s.close(); }
});
it('re-ACKs duplicate DATA, ignores reordering, and re-ACKs duplicate FIN once delivered', async () => {
  const s = setup((p, side) => {
    if (!side && p.kind === Kind.DATA && p.seq === 0) {
      s.b.inject(encodePacket({ ...p, seq: 1, payload: data.subarray(120, 240) }));
    }
    return { copies: 2 };
  });
  try {
    await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]);
    await s.clock.flush();
    const fin = s.a.log.find(p => p.kind === Kind.FIN)!;
    s.b.inject(encodePacket(fin)); await s.clock.next(); await s.clock.next();
    expect(s.b.log.filter(p => p.kind === Kind.FIN_ACK).length).toBeGreaterThan(1);
    expect(s.delivered).toHaveLength(1);
  } finally { s.close(); }
});
it('ignores stale session/transfer/sequence ACKs and retries the actual outstanding DATA', async () => {
  const s = setup((p, _side, n) => {
    if (p.kind === Kind.ACK && p.seq === 0 && n === 1) {
      for (const wrong of [{ session: p.session + 1 }, { transfer: p.transfer + 1 }, { seq: p.seq + 1 }]) s.a.inject(encodePacket({ ...p, ...wrong }));
      return { drop: true };
    }
  });
  try { await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]); expect(s.a.log.filter(p => p.kind === Kind.DATA && p.seq === 0)).toHaveLength(2); }
  finally { s.close(); }
});
it('handles delayed old ACKs while later DATA is outstanding', async () => {
  const s = setup((p, _side, n) => p.kind === Kind.ACK && p.seq === 0 && n === 1 ? { delay: 14000 } : undefined);
  try { await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]); }
  finally { s.close(); }
});
it('retries CRC-corrupt packets and refuses transfer completion for a mismatched whole-data CRC', async () => {
  const s = setup((p, side, n, bytes) => {
    if (!side && p.kind === Kind.DATA && n === 1) { const corrupt = bytes.slice(); corrupt[16] ^= 1; return { replace: corrupt }; }
  });
  try { await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]); expect(s.diagnostics.some(d => d.includes('CRC32 mismatch'))).toBe(true); }
  finally { s.close(); }
  const bad = setup((p, side) => !side && p.kind === Kind.DATA ? { replace: encodePacket({ ...p, payload: new Uint8Array(p.payload.length) }) } : undefined);
  try { await expect(bad.clock.drive(bad.tx.send(data))).rejects.toThrow('FIN_ACK timed out'); expect(bad.delivered).toHaveLength(0); }
  finally { bad.close(); }
});
it('bounds timeouts and retries, includes random backoff, and never claims success without FIN_ACK', async () => {
  const s = setup(p => p.kind === Kind.FIN_ACK ? { drop: true } : undefined);
  try {
    await expect(s.clock.drive(s.tx.send(data))).rejects.toThrow('FIN_ACK timed out after 4 attempts');
    expect(s.delivered).toEqual([data]); expect(s.a.log.filter(p => p.kind === Kind.FIN)).toHaveLength(4);
    expect(s.states.at(-1)).toContain('failed:'); expect(s.states.some(d => d.includes('Transfer confirmed'))).toBe(false);
    expect(s.clock.now()).toBeGreaterThan(4 * 12000 + 7000);
  } finally { s.close(); }
});
it('cancels during playback/timeout and sends only an acoustic best-effort CANCEL', async () => {
  for (const duringPlayback of [true, false]) {
    const s = setup(() => ({ drop: true }));
    try {
      const work = s.tx.send(data); void work.catch(() => {});
      await s.clock.next(); if (!duringPlayback) await s.clock.next();
      s.tx.cancel();
      await expect(s.clock.drive(work)).rejects.toThrow('cancelled');
      expect(s.states.at(-1)).toContain('cancelled:'); expect(s.delivered).toHaveLength(0);
      expect(s.a.log.at(-1)?.kind).toBe(Kind.CANCEL);
    } finally { s.close(); }
  }
});
it('rejects unknown DATA and oversized HELLO before buffering; stale sessions cannot replace a live session', async () => {
  const s = setup();
  const hello: Packet = { kind: Kind.HELLO, session: 10, transfer: 20, seq: 0, payload: offerBytes({ total: 4, checksum: crc32(new Uint8Array(4)), chunk: 120, maxTransfer: 4096 }) };
  try {
    s.b.inject(encodePacket({ ...hello, kind: Kind.DATA, payload: new Uint8Array(4) })); expect(s.rx.resources.receiveBytes).toBe(0);
    s.b.inject(encodePacket({ ...hello, payload: offerBytes({ total: 0xffffffff, checksum: 0, chunk: 120, maxTransfer: 0xffffffff }) })); expect(s.rx.resources.receiveBytes).toBe(0);
    s.b.inject(encodePacket(hello)); expect(s.rx.resources.receiveBytes).toBe(4);
    s.b.inject(encodePacket({ ...hello, session: 11, payload: offerBytes({ total: 100, checksum: 0, chunk: 120, maxTransfer: 4096 }) })); expect(s.rx.resources.receiveBytes).toBe(4);
    s.rx.cancel(); expect(s.rx.resources.receiveBytes).toBe(0);
    s.b.inject(encodePacket(hello)); expect(s.rx.resources.receiveBytes).toBe(0);
  } finally { s.close(); }
});
it('expires abandoned receive buffers and rejects premature FIN and wrong final digest', async () => {
  const s = setup();
  try {
    const p: Packet = { kind: Kind.HELLO, session: 3, transfer: 4, seq: 0, payload: offerBytes({ total: 4, checksum: 123, chunk: 120, maxTransfer: 4096 }) };
    s.b.inject(encodePacket(p));
    s.b.inject(encodePacket({ ...p, kind: Kind.FIN, seq: 1, payload: finishBytes(4, 123) }));
    expect(s.delivered).toHaveLength(0);
    for (let i = 0; i < 5; i++) await s.clock.next();
    expect(s.rx.resources.receiveBytes).toBe(0); expect(s.rx.resources.tombstones).toBe(1);
  } finally { s.close(); }
});
it('never delivers local transmitted HELLO, DATA or FIN as incoming content', async () => {
  const s = setup((p, side, _n, bytes) => { if (!side) s.a.inject(bytes); return undefined; });
  try { await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data]); expect(s.selfDelivered).toHaveLength(0); }
  finally { s.close(); }
});
it('ignores ACKs and HELLO from a completed session during a fresh transfer', async () => {
  let oldAck: Packet | undefined;
  const s = setup((p, side) => {
    if (side && p.kind === Kind.ACK) oldAck ??= p;
    if (!side && p.kind === Kind.DATA && oldAck && p.session !== oldAck.session) s.a.inject(encodePacket(oldAck));
  });
  try {
    await s.clock.drive(s.tx.send(data)); await s.clock.flush();
    const hello = s.a.log.find(p => p.kind === Kind.HELLO)!;
    s.b.inject(encodePacket(hello)); expect(s.rx.resources.receiveBytes).toBe(0);
    await s.clock.drive(s.tx.send(data)); expect(s.delivered).toEqual([data, data]);
    expect(s.a.log.filter(p => p.kind === Kind.HELLO).map(p => p.session)).toEqual([41, 43]);
  } finally { s.close(); }
});
it('fails DATA ACK exhaustion without delivering partial content or advancing to FIN', async () => {
  const s = setup(p => p.kind === Kind.ACK ? { drop: true } : undefined);
  try {
    await expect(s.clock.drive(s.tx.send(data))).rejects.toThrow('ACK timed out after 4 attempts');
    expect(s.a.log.filter(p => p.kind === Kind.DATA)).toHaveLength(4);
    expect(s.a.log.some(p => p.kind === Kind.FIN)).toBe(false); expect(s.delivered).toHaveLength(0);
  } finally { s.close(); }
});
it('supports receiver cancellation and frees partial data', async () => {
  const s = setup(p => p.kind === Kind.DATA ? { drop: true } : undefined);
  try {
    const work = s.tx.send(data); void work.catch(() => {});
    while (!s.rx.resources.receiveBytes) await s.clock.next();
    // Let CAPS playback finish before the receiver issues cancellation.
    await s.clock.next(); await s.clock.next();
    s.rx.cancel();
    await expect(s.clock.drive(work)).rejects.toThrow('Peer cancelled');
    expect(s.rx.resources.receiveBytes).toBe(0); expect(s.delivered).toHaveLength(0);
  } finally { s.close(); }
});
it('bounds retirement records without evicting FIN replay protection for new requests', async () => {
  const s = setup();
  try {
    for (let i = 1; i <= 32; i++) {
      s.b.inject(encodePacket({ kind: Kind.HELLO, session: i, transfer: i, seq: 0, payload: offerBytes({ total: 1, checksum: 0, chunk: 120, maxTransfer: 4096 }) }));
      expect(s.rx.resources.receiveBytes, `iteration ${i} at ${s.clock.now()} ms`).toBe(1); s.rx.cancel();
      while (s.rx.resources.replying) await s.clock.next();
    }
    expect(s.rx.resources.tombstones).toBe(32);
    s.b.inject(encodePacket({ kind: Kind.HELLO, session: 100, transfer: 100, seq: 0, payload: offerBytes({ total: 4096, checksum: 0, chunk: 120, maxTransfer: 4096 }) }));
    expect(s.rx.resources.receiveBytes).toBe(0); expect(s.rx.resources.tombstones).toBe(32);
  } finally { s.close(); }
});
it('bounds hung playback with the injected watchdog clock', async () => {
  const s = setup();
  s.a.send = async (_bytes, signal) => s.clock.sleep(60000, signal);
  try { await expect(s.clock.drive(s.tx.send(data))).rejects.toThrow('playback exceeded 30 seconds'); expect(s.states.at(-1)).toContain('failed'); }
  finally { s.close(); }
});

it('recovers random binary content, a lost middle chunk and duplicate ACKs with monotonic byte progress', async () => {
  const s = setup((p, side, occurrence) => !side && p.kind === Kind.DATA && p.seq === 2 && occurrence === 1 ? { drop: true } : { copies: 2 });
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(4030));
    const name = '橋 नमस्ते.bin', body = packContent('file', name, bytes), progress: number[] = [];
    await s.clock.drive(s.tx.send(body, { content: true, acknowledged: n => progress.push(Math.max(0, n - manifestSize(name))) }));
    expect(s.content).toHaveLength(1); expect(s.content[0].bytes).toEqual(bytes);
    expect(s.content[0].name).toBe(name);
    expect(progress).toEqual(Array.from({ length: Math.ceil(body.length / 120) }, (_, i) => Math.min(bytes.length, (i + 1) * 120 - manifestSize(name))));
    expect(s.a.log.filter(p => p.kind === Kind.CONTENT_DATA_ALT && p.seq === 2)).toHaveLength(1);
  } finally { s.close(); }
});
for (const invalid of ['manifest', 'hash']) {
  it('refuses FIN_ACK and delivery for a CRC-valid body with invalid ' + invalid, async () => {
    const s = setup();
    try {
      const body = packContent('file', 'file.bin', data);
      body[invalid === 'manifest' ? 0 : 5] ^= 255;
      await expect(s.clock.drive(s.tx.send(body, { content: true }))).rejects.toThrow('Peer cancelled');
      expect(s.states.some(state => state.includes(invalid === 'manifest' ? 'Invalid manifest' : 'SHA-256 mismatch'))).toBe(true);
      expect(s.b.log.some(p => p.kind === Kind.FIN_ACK)).toBe(false);
      expect(s.content).toHaveLength(0); expect(s.rx.resources.receiveBytes).toBe(0);
    } finally { s.close(); }
  });
}
it('discards a partially acknowledged file on cancellation', async () => {
  const s = setup();
  try {
    const body = packContent('file', 'partial.bin', data);
    await expect(s.clock.drive(s.tx.send(body, { content: true, acknowledged: () => s.tx.cancel() }))).rejects.toThrow('cancelled');
    await s.clock.next(); // Deliver the scheduled zero-delay acoustic CANCEL.
    expect(s.content).toHaveLength(0); expect(s.rx.resources.receiveBytes).toBe(0);
    expect(s.b.log.some(p => p.kind === Kind.FIN_ACK)).toBe(false);
  } finally { s.close(); }
});

it('re-ACKs identical logical content carried by a differently masked retry after ACK loss', async () => {
  const s = setup((p, side, n) => side && p.kind === Kind.ACK && p.seq === 1 && n === 1 ? { drop: true } : undefined);
  try {
    const acked: number[] = [], body = packContent('file', 'retry.bin', data);
    await s.clock.drive(s.tx.send(body, { content: true, acknowledged: n => acked.push(n) }));
    expect(s.a.log.some(p => p.kind === Kind.CONTENT_DATA_ALT && p.seq === 1)).toBe(true);
    expect(acked).toEqual([120, 240, body.length]); expect(s.content.map(item => item.bytes)).toEqual([data]);
  } finally { s.close(); }
});
it('requires a content-aware peer before sending any file bytes', async () => {
  const s = setup();
  s.rx.dispose();
  const legacy = new StopAndWait(s.b, s.clock, { deliver: bytes => s.delivered.push(bytes) });
  try {
    await expect(s.clock.drive(s.tx.send(packContent('file', 'sample.bin', data), { content: true }))).rejects.toThrow('CONTENT_CAPS timed out');
    expect(s.a.log.some(p => p.kind === Kind.DATA)).toBe(false);
    expect(s.delivered).toHaveLength(0);
  } finally { legacy.dispose(); s.close(); }
});

for (const lost of [Kind.SET_POLICY, Kind.POLICY_ACK]) {
  it(`retries a lost ${Kind[lost]} and confirms Robust before sending content`, async () => {
    const s = setup((p, _side, n) => p.kind === lost && n === 1 ? { drop: true } : undefined);
    try {
      s.tx.controller.select('Robust');
      await s.clock.drive(s.tx.send(packContent('file', 'test', data), { content: true }));
      expect(s.content.map(c => c.bytes)).toEqual([data]);
      expect(s.a.log.filter(p => p.kind === Kind.SET_POLICY)).toHaveLength(2);
      expect(s.tx.controller.snapshot().history.join(' ')).toContain('Peer confirmed Robust');
    } finally { s.close(); }
  });
}
it('rejects stale or wrong policy echoes, abandons uncertain switch and starts a fresh baseline transfer', async () => {
  const s = setup(p => {
    if (p.kind !== Kind.POLICY_ACK) return;
    for (const wrong of [{ session: p.session + 1 }, { seq: p.seq + 1 }, { payload: Uint8Array.of(0) }])
      s.a.inject(encodePacket({ ...p, ...wrong }));
    return { drop: true };
  });
  try {
    const body = packContent('file', 'test', data);
    s.tx.controller.select('Robust');
    await expect(s.clock.drive(s.tx.send(body, { content: true }))).rejects.toThrow('POLICY_ACK timed out after 2');
    expect(s.a.log.some(p => p.kind === Kind.DATA)).toBe(false);
    expect(s.content).toHaveLength(0);
    await s.clock.next(); // deliver the acoustic CANCEL
    s.tx.controller.select('Balanced');
    await s.clock.drive(s.tx.send(body, { content: true }));
    expect(s.content.map(c => c.bytes)).toEqual([data]);
  } finally { s.close(); }
});
it('falls back after reverse ACK loss despite the receiver having advanced, then negotiates recovery', async () => {
  const s = setup((p, _side, n) => p.kind === Kind.ACK && p.seq === 0 && n <= 2 ? { drop: true } : undefined);
  try {
    const file = new Uint8Array(2400);
    s.tx.controller.select('Adaptive');
    await s.clock.drive(s.tx.send(packContent('file', 'recovery', file), { content: true }));
    expect(s.content.map(c => c.bytes)).toEqual([file]);
    expect(s.a.log.filter(p => p.kind === Kind.SET_POLICY).map(p => p.payload[0])).toEqual([1, 0]);
    expect(s.tx.controller.snapshot().history.join(' ')).toContain('two consecutive DATA ACK timeouts');
  } finally { s.close(); }
});

it('allows exactly six Robust DATA attempts, never overlapping or blindly repeating after an ACK', async () => {
  for (const lost of [4, 6]) {
    const s = setup((p, _side, n) => p.kind === Kind.ACK && n <= lost ? { drop: true } : undefined);
    try {
      s.tx.controller.select('Robust');
      const sent = s.clock.drive(s.tx.send(packContent('file', 'x', Uint8Array.of(7)), { content: true }));
      if (lost === 6) await expect(sent).rejects.toThrow('ACK timed out after 6 attempts');
      else await sent;
      expect(s.a.log.filter(p => p.kind === Kind.DATA || p.kind === Kind.CONTENT_DATA_ALT)).toHaveLength(Math.min(lost + 1, 6));
      expect(s.content.length).toBe(lost === 6 ? 0 : 1);
    } finally { s.close(); }
  }
});
it('resets Adaptive to Balanced for the next transfer after losing both switch requests', async () => {
  let initial = true;
  const s = setup((p, _side, n) => initial && ((p.kind === Kind.ACK && n <= 2) || p.kind === Kind.SET_POLICY) ? { drop: true } : undefined);
  try {
    s.tx.controller.select('Adaptive');
    const body = packContent('file', 'retry', data);
    await expect(s.clock.drive(s.tx.send(body, { content: true }))).rejects.toThrow('POLICY_ACK timed out after 2');
    expect(s.tx.controller.target).toBe('Balanced');
    expect(s.tx.controller.snapshot()).toMatchObject({ attempts: 2, acks: 0, retries: 1 });
    await s.clock.next(); initial = false;
    await s.clock.drive(s.tx.send(body, { content: true }));
    expect(s.content.map(c => c.bytes)).toEqual([data]);
  } finally { s.close(); }
});
