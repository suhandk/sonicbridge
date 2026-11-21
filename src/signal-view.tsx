import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/sodium/ui/button';
import { Empty, EmptyHeader, EmptyTitle } from '@/components/sodium/ui/empty-state';
import { Frame, FrameBody, FrameFooter, FrameHeader, FrameStatus, FrameTitle } from '@/components/sodium/ui/frame';
import { SegmentedControl, SegmentedControlItem } from '@/components/sodium/ui/segmented-control';
import { Status } from '@/components/sodium/ui/status';
import { StatusStrip, StatusStripCell, StatusStripLabel, StatusStripUnit, StatusStripValue } from '@/components/sodium/ui/status-strip';

export interface SignalFrame { pcm: Float32Array; rate: number; source: string; position?: () => number | undefined }
const N = 64;
const cos = new Float32Array(N*N/2), sin = new Float32Array(cos.length);
for (let k = 0; k < N/2; k++) for (let i = 0; i < N; i++) {
  const angle = 2*Math.PI*k*i/N, window = 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
  cos[k*N+i] = Math.cos(angle)*window; sin[k*N+i] = Math.sin(angle)*window;
}
function draw(canvas: HTMLCanvasElement, frame: SignalFrame, spectrum: boolean) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const { width, height } = canvas, pcm = frame.pcm;
  const palette = getComputedStyle(canvas);
  const forcedColors = matchMedia('(forced-colors: active)').matches;
  const trace = forcedColors ? 'CanvasText' : palette.getPropertyValue('--accent-text').trim();
  const heat = forcedColors ? 'CanvasText' : palette.getPropertyValue('--data-1').trim();
  ctx.clearRect(0, 0, width, height);
  if (!spectrum) {
    ctx.strokeStyle = trace; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const start = Math.floor(x*pcm.length/width), end = Math.max(start+1, Math.floor((x+1)*pcm.length/width));
      let min = pcm[start], max = min;
      for (let i = start+1; i < end; i++) { min = Math.min(min, pcm[i]); max = Math.max(max, pcm[i]); }
      ctx.moveTo(x, height*(1-max)/2); ctx.lineTo(x, height*(1-min)/2 + 1);
    }
    ctx.stroke(); return;
  }
  const columns = Math.floor(pcm.length/N);
  ctx.fillStyle = heat;
  for (let x = 0; x < columns; x++) for (let k = 0; k < N/2; k++) {
    let real = 0, imag = 0;
    for (let i = 0; i < N; i++) { real += pcm[x*N+i]*cos[k*N+i]; imag += pcm[x*N+i]*sin[k*N+i]; }
    const db = 20*Math.log10(Math.max(1e-8, 4*Math.hypot(real,imag)/N));
    const strength = Math.max(0, Math.min(1, (db+80)/80));
    ctx.globalAlpha = strength;
    ctx.fillRect(x*width/columns, height-(k+1)*height/(N/2), Math.ceil(width/columns), Math.ceil(height/(N/2)));
  }
  ctx.globalAlpha = 1;
}
interface InstrumentProps {
  frame: RefObject<SignalFrame | undefined>;
  live: boolean;
  verified: boolean;
  caption: string;
}
function currentWindow(frame?: SignalFrame): SignalFrame | undefined {
  if (!frame?.position) return frame;
  const seconds = frame.position();
  if (seconds === undefined) return;
  const offset = Math.max(0, Math.floor(seconds * frame.rate));
  const pcm = frame.pcm.subarray(offset, offset + 2048);
  return pcm.length ? { ...frame, pcm } : undefined;
}
export function SignalView({ frame, live, verified, caption }: InstrumentProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [spectrum, setSpectrum] = useState(false), [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [display, setDisplay] = useState<SignalFrame>();
  useEffect(() => {
    if (paused) return;
    const refresh = () => { if (!document.hidden) setDisplay(currentWindow(frame.current)); };
    refresh(); const timer = setInterval(refresh, 250); return () => clearInterval(timer);
  }, [paused, frame]);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || !display) return;
    const redraw = () => draw(surface, display, spectrum);
    redraw();
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [display, spectrum]);
  let peak = 0;
  if (display) for (const value of display.pcm) peak = Math.max(peak, Math.abs(value));
  const windowMs = display ? 1000 * display.pcm.length / display.rate : undefined;
  const axisLabels = spectrum ? [display ? (display.rate / 2000).toLocaleString() : 'Nyq', '0'] : ['+1', '0', '−1'];
  const signalStatus = paused ? 'paused' : live ? 'running' : verified ? 'ok' : 'idle';
  const signalLabel = { paused: 'Paused', running: 'Live', ok: 'Verified', idle: display ? 'Captured' : 'Standby' }[signalStatus];

  return <Frame className="scope" aria-label="Signal monitor">
    <FrameHeader>
      <FrameTitle>Signal monitor</FrameTitle>
      <FrameStatus><Status size="sm" status={signalStatus}>{signalLabel}</Status></FrameStatus>
    </FrameHeader>
    <FrameBody className="signal-chart">
      <div className="signal-caption type-label-sm"><span>{display?.source ?? caption}</span><span>{spectrum ? 'Frequency · kHz' : 'Amplitude · FS'}</span></div>
      <div className="signal-frame">
        <div className="signal-y-axis type-micro" aria-hidden="true">{axisLabels.map(label => <span key={label}>{label}</span>)}</div>
        <div className="signal-plot">
          {!spectrum && <div className="signal-zero" aria-hidden="true"/>}
          {display ? <canvas ref={canvas} width={512} height={192} role="img" aria-label={spectrum ? 'Spectrogram of sampled PCM' : 'Waveform of sampled PCM'}/> :
            <Empty className="signal-empty" reason="empty" variant="plain" size="sm"><EmptyHeader><EmptyTitle>Waiting for audio</EmptyTitle></EmptyHeader></Empty>}
        </div>
        <div className="signal-x-axis type-micro" aria-hidden="true"><span>0 ms</span><span>{windowMs === undefined ? 'Time' : `${windowMs.toFixed(1)} ms`}</span></div>
      </div>
    </FrameBody>
    <FrameBody padding="none">
      <StatusStrip label="Sample measurements" variant="plain" className="signal-metrics">
        <StatusStripCell>
          <StatusStripLabel>Sample rate</StatusStripLabel>
          <StatusStripValue>{display ? <>{(display.rate / 1000).toLocaleString()} <StatusStripUnit>kHz</StatusStripUnit></> : '—'}</StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Peak</StatusStripLabel>
          <StatusStripValue>{display ? <>{peak.toFixed(3)} <StatusStripUnit>FS</StatusStripUnit></> : '—'}</StatusStripValue>
        </StatusStripCell>
        <StatusStripCell>
          <StatusStripLabel>Window</StatusStripLabel>
          <StatusStripValue>{windowMs === undefined ? '—' : <>{windowMs.toFixed(1)} <StatusStripUnit>ms</StatusStripUnit></>}</StatusStripValue>
        </StatusStripCell>
      </StatusStrip>
    </FrameBody>
    <FrameFooter className="signal-controls">
      <SegmentedControl multiple aria-label="Signal display" value={[spectrum ? 'spectrogram' : 'waveform']} onValueChange={values => {
        if (values.length === 2) setSpectrum(value => !value);
      }}>
        <SegmentedControlItem value="waveform">Waveform</SegmentedControlItem>
        <SegmentedControlItem value="spectrogram">Spectrogram</SegmentedControlItem>
      </SegmentedControl>
      <Button variant="secondary" onClick={() => { if (paused) setDisplay(currentWindow(frame.current)); setPaused(!paused); }}>{paused ? 'Resume plot' : 'Pause plot'}</Button>
    </FrameFooter>
  </Frame>;
}
