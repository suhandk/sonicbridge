import { useEffect, useRef, useState, type RefObject } from 'react';

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
  ctx.clearRect(0, 0, width, height);
  if (!spectrum) {
    ctx.strokeStyle = '#8df1f5'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const start = Math.floor(x*pcm.length/width), end = Math.max(start+1, Math.floor((x+1)*pcm.length/width));
      let min = pcm[start], max = min;
      for (let i = start+1; i < end; i++) { min = Math.min(min, pcm[i]); max = Math.max(max, pcm[i]); }
      ctx.moveTo(x, height*(1-max)/2); ctx.lineTo(x, height*(1-min)/2 + 1);
    }
    ctx.stroke(); return;
  }
  const columns = Math.floor(pcm.length/N);
  for (let x = 0; x < columns; x++) for (let k = 0; k < N/2; k++) {
    let real = 0, imag = 0;
    for (let i = 0; i < N; i++) { real += pcm[x*N+i]*cos[k*N+i]; imag += pcm[x*N+i]*sin[k*N+i]; }
    const db = 20*Math.log10(Math.max(1e-8, 4*Math.hypot(real,imag)/N));
    const strength = Math.max(0, Math.min(1, (db+80)/80));
    ctx.fillStyle = `rgb(141 241 245 / ${strength})`;
    ctx.fillRect(x*width/columns, height-(k+1)*height/(N/2), Math.ceil(width/columns), Math.ceil(height/(N/2)));
  }
}
interface InstrumentProps {
  frame: RefObject<SignalFrame | undefined>;
  engagement: number;
  engaging: boolean;
  live: boolean;
  receiving: boolean;
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
export function SignalView({ frame, engagement, engaging, live, receiving, verified, caption }: InstrumentProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [spectrum, setSpectrum] = useState(false), [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [display, setDisplay] = useState<SignalFrame>();
  useEffect(() => {
    if (paused) return;
    const refresh = () => { if (!document.hidden) setDisplay(currentWindow(frame.current)); };
    refresh(); const timer = setInterval(refresh, 250); return () => clearInterval(timer);
  }, [paused, frame]);
  useEffect(() => { if (canvas.current && display) draw(canvas.current, display, spectrum); }, [display, spectrum]);
  let peak = 0;
  if (live && display && !paused) for (const value of display.pcm) peak = Math.max(peak, Math.abs(value));
  return <section className="scope" aria-label="Signal monitor">
    <div className="instrument-title"><h2>Acoustic transducer</h2><span>{caption}</span></div>
    <div className="housing" data-receive={receiving} data-verified={verified} aria-hidden="true">
      <div key={engagement} className={'driver'+(engaging ? ' engaging' : '')}>
        <div className="rim"><div className="surround"><div className="diaphragm" style={{scale:1+peak*.035}}><div className="dustcap"/></div></div></div>
        <i className="screw nw"/><i className="screw ne"/><i className="screw sw"/><i className="screw se"/>
      </div>
    </div>
    <div className="scope-head"><h2>Signal monitor</h2><span className="mono">{display?.source ?? 'Standby'}</span></div>
    <div className="plot">{display ? <canvas ref={canvas} width={512} height={100} role="img" aria-label={spectrum ? 'Spectrogram of sampled PCM' : 'Waveform of sampled PCM'}/> : <span>Waiting for audio</span>}</div>
    <div className="scope-axis mono"><span>{spectrum ? 'Frequency · 0 to Nyquist' : 'Amplitude · ±1 FS'}</span><span>{display ? `${(1000*display.pcm.length/display.rate).toFixed(1)} ms · ${display.rate} Hz` : '— ms'}</span></div>
    <div className="scope-actions"><div className="pair"><button aria-pressed={!spectrum} onClick={() => setSpectrum(false)}>Waveform</button><button aria-pressed={spectrum} onClick={() => setSpectrum(true)}>Spectrogram</button></div>
    <button onClick={() => { if (paused) setDisplay(currentWindow(frame.current)); setPaused(!paused); }}>{paused ? 'Resume plot' : 'Pause plot'}</button></div>
  </section>;
}
