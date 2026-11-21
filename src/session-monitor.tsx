import { useEffect, useState } from 'react';
import { Kind } from './protocol';
import type { PacketEvent, TransportState } from './transport';
import type { Policy } from './controller';

export type Progress = { acked: number; total: number; at?: number; rate?: number };
export type Session = { start: number; last: number; phase: TransportState; retries: number; policy: Policy; receive: boolean; virtual: boolean };
const phaseLabel: Record<TransportState, string> = { idle: 'Standby', negotiating: 'Contacting receiver', sending: 'Sending data', receiving: 'Receiving data', finishing: 'Awaiting verification', received: 'Verified at receiver', completed: 'Delivery confirmed', failed: 'Delivery unconfirmed', cancelled: 'Cancelled' };
export const active = (phase?: TransportState) => !!phase && ['negotiating', 'sending', 'receiving', 'finishing'].includes(phase);
export function duration(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds)); return whole >= 60 ? `${Math.floor(whole/60)}m ${whole%60}s` : `${whole}s`;
}
export function SessionMonitor({ session, progress, events, simulated, estimate }: { session?: Session; progress?: Progress; events: PacketEvent[]; simulated: boolean; estimate?: number }) {
  const [now, setNow] = useState(0);
  const running = active(session?.phase);
  useEffect(() => {
    if (!running || simulated) return;
    setNow(performance.now()); const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, [running, simulated]);
  const elapsed = session ? (Math.max(session.last, running && !simulated ? now : 0) - session.start)/1000 : 0;
  const phase = session?.phase ?? 'idle';
  const eta = progress?.rate && progress.acked < progress.total
    ? (progress.total-progress.acked)/progress.rate + 6 : undefined;
  const etaLabel = !running ? '—' : phase === 'finishing' ? 'Awaiting FIN_ACK' : (progress && progress.acked === progress.total) ? 'Verifying' :
    eta !== undefined ? '~' + duration(eta) : estimate !== undefined && estimate > elapsed ? '~' + duration(estimate-elapsed) : 'Estimating';
  return <section className="card monitor" id="monitor" tabIndex={-1} aria-label="Transfer monitor"><div className="card-heading"><h2>Transfer monitor</h2><span className={'pill '+(phase === 'completed' || phase === 'received' ? 'green' : '')}>{phaseLabel[phase]}</span></div>
    <p className="bytes" key={progress?.acked}>{progress ? progress.acked.toLocaleString() : '—'} <small>{progress ? '/ '+progress.total.toLocaleString()+' B' : 'bytes'}</small></p>
    <div className="track" role={progress?.total ? 'progressbar' : undefined} aria-label={progress?.total ? 'Unique payload bytes' : undefined} aria-valuemin={0} aria-valuenow={progress?.acked} aria-valuemax={progress?.total}><i style={{width: `${progress?.total ? 100*progress.acked/progress.total : 0}%`}}/></div>
    <p className="fine">{progress ? `${progress.acked} / ${progress.total} unique content bytes ${session?.receive ? 'reassembled' : 'acknowledged'}` : 'Unique payload bytes'}</p>
    <dl className="metrics"><div><dt>{simulated ? 'Simulated elapsed' : 'Elapsed'}</dt><dd>{session ? duration(elapsed) : '—'}</dd></div><div><dt>Estimated remaining</dt><dd>{etaLabel}</dd></div><div><dt>Local retries</dt><dd className={session?.retries ? "retry-count" : undefined} key={session?.retries}>{session ? session.retries : '—'}</dd></div><div><dt>{running ? 'Active profile' : 'Modem profile'}</dt><dd>{session ? 'Audible Fast · '+session.policy : '—'}</dd></div></dl>
    <details className="timeline"><summary>Packet timeline <span>{events.length} recent</span></summary>
    {events.length ? <p className="fine">Time from the first retained event. TX marks submission to the modem.</p> : null}
    {events.length ? <ol>{events.slice().reverse().map((e,i) => <li key={i}><time>{((e.at-events[0].at)/1000).toFixed(1)}s</time><b>{e.direction === 'submit' ? 'TX submit' : e.direction === 'decode' ? 'RX decode' : 'Timeout'}</b><span title={'Session '+e.session+', transfer '+e.transfer}>{Kind[e.kind]} #{e.seq}{e.attempt ? ' · try '+e.attempt : ''}</span></li>)}</ol> : <p>Packets appear here as the link runs.</p>}</details>
  </section>;
}
