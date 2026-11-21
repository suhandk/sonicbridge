import { useEffect, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/sodium/ui/collapsible';
import { Frame, FrameBody, FrameHeader, FrameStatus, FrameTitle } from '@/components/sodium/ui/frame';
import { Progress as TransferProgress, ProgressLabel, ProgressValue } from '@/components/sodium/ui/progress';
import { Status } from '@/components/sodium/ui/status';
import { StatusStrip, StatusStripCell, StatusStripLabel, StatusStripValue } from '@/components/sodium/ui/status-strip';
import { Kind } from '@/protocol';
import type { PacketEvent, TransportState } from '@/transport';
import type { Policy } from '@/controller';
import type { AudibleProfile } from '@/modem';

export type Progress = { acked: number; total: number; at?: number; rate?: number };
export type DeliveryProof = 'content-verified' | 'legacy-verified' | 'acknowledged';
export type Session = { start: number; last: number; phase: TransportState; retries: number; profile: AudibleProfile; policy: Policy; receive: boolean; virtual: boolean; proof?: DeliveryProof };
const phaseLabel: Record<TransportState, string> = { idle: 'Standby', negotiating: 'Contacting receiver', sending: 'Sending data', receiving: 'Receiving data', finishing: 'Awaiting verification', received: 'Verified at receiver', completed: 'Delivery confirmed', failed: 'Delivery unconfirmed', cancelled: 'Cancelled' };
export const active = (phase?: TransportState) => !!phase && ['negotiating', 'sending', 'receiving', 'finishing'].includes(phase);
export function duration(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds)); return whole >= 60 ? `${Math.floor(whole/60)}m ${whole%60}s` : `${whole}s`;
}
export function RunProgress({ session, progress, events, simulated, estimate }: { session?: Session; progress?: Progress; events: PacketEvent[]; simulated: boolean; estimate?: number }) {
  const [now, setNow] = useState(0);
  const running = active(session?.phase);
  useEffect(() => {
    if (!running || simulated) return;
    setNow(performance.now()); const timer = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(timer);
  }, [running, simulated]);
  const elapsed = session ? (Math.max(session.last, running && !simulated ? now : 0) - session.start)/1000 : 0;
  const phase = session?.phase ?? 'idle';
  const proof = session?.proof;
  const label = !proof && (phase === 'completed' || phase === 'received') ? 'Link exchange verified' : phaseLabel[phase];
  const eta = progress?.rate && progress.acked < progress.total
    ? (progress.total-progress.acked)/progress.rate + 6 : undefined;
  const etaLabel = !running ? '–' : phase === 'finishing' ? 'Awaiting FIN_ACK' : (progress && progress.acked === progress.total) ? 'Verifying' :
    eta !== undefined ? '~' + duration(eta) : estimate !== undefined && estimate > elapsed ? '~' + duration(estimate-elapsed) : 'Estimating';
  const status = running ? 'running' : phase === 'failed' ? 'fail' : phase === 'cancelled' ? 'paused'
    : phase === 'completed' || phase === 'received' ? 'ok' : 'idle';
  const metrics = [
    { label: simulated ? 'Simulated elapsed' : 'Elapsed', value: session ? duration(elapsed) : '–' },
    { label: 'Time remaining', value: etaLabel },
    { label: 'Local retries', value: session?.retries ?? '–' },
    { label: 'Playback profile', value: session ? `${session.profile} · ${session.policy}` : '–' },
  ];
  return <Frame className="monitor" id="monitor" tabIndex={-1} aria-labelledby="transfer-monitor-title">
    <FrameHeader className="flex-wrap">
      <FrameTitle id="transfer-monitor-title">Transfer monitor</FrameTitle>
      <FrameStatus><Status size="sm" status={status}>{label}</Status></FrameStatus>
    </FrameHeader>
    {proof && <FrameBody>
      <section aria-label="Delivery proof">
        <p className="type-label text-ok-text">{proof === 'acknowledged' ? 'Final acknowledgement received' : 'Content verified'}</p>
        <p className="type-body-sm mt-2 text-text-2">{proof === 'acknowledged'
          ? session?.virtual ? 'The simulated receiver verified SHA-256 and returned FIN_ACK through local PCM.' : 'The receiver verified SHA-256 and its acoustic FIN_ACK reached this device.'
          : `${proof === 'content-verified' ? 'SHA-256 matched.' : 'Transfer CRC32 matched.'} FIN_ACK queued on this device. Sender confirmation is shown on the other device.`}</p>
      </section>
    </FrameBody>}
    <FrameBody>
      {progress?.total ? <TransferProgress value={progress.acked} max={progress.total} status={phase === 'failed' ? 'fail' : undefined}>
        <ProgressLabel>Bytes {session?.receive ? 'reassembled' : 'acknowledged'}</ProgressLabel>
        <ProgressValue>{() => `${progress.acked.toLocaleString()} / ${progress.total.toLocaleString()} B`}</ProgressValue>
      </TransferProgress> : <p className="type-body-sm text-text-2">Byte progress appears as the devices exchange packets.</p>}
    </FrameBody>
    <FrameBody padding="none">
      <StatusStrip variant="plain" label="Transfer statistics" className="[&_[data-slot=status-strip-cells]]:grid-cols-2">
        {metrics.map(metric => <StatusStripCell key={metric.label}>
          <StatusStripLabel>{metric.label}</StatusStripLabel>
          <StatusStripValue className="whitespace-normal">{metric.value}</StatusStripValue>
        </StatusStripCell>)}
      </StatusStrip>
    </FrameBody>
    <FrameBody padding="none">
      <Collapsible className="timeline">
        <CollapsibleTrigger className="min-h-11 w-full px-3" summary={`${events.length} recent`}>Packet timeline</CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          {events.length ? <>
            <p className="type-body-sm text-text-2">Time from the first retained event. TX marks submission to the modem.</p>
            <ol>{events.slice().reverse().map((e, i) => <li key={i}>
              <time>{((e.at - events[0].at) / 1000).toFixed(1)}s</time>
              <span>{e.direction === 'submit' ? 'TX submit' : e.direction === 'decode' ? 'RX decode' : 'Timeout'}</span>
              <span title={`Session ${e.session}, transfer ${e.transfer}`}>{Kind[e.kind]} #{e.seq}{e.attempt ? ` · try ${e.attempt}` : ''}</span>
            </li>)}</ol>
          </> : <p className="type-body-sm text-text-2">Packets appear here as the link runs.</p>}
        </CollapsibleContent>
      </Collapsible>
    </FrameBody>
  </Frame>;
}
