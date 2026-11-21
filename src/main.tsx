import type { OperatingMode, ControllerSnapshot } from './controller';
import { estimateTransfer, manifestSize, packContent, safeName, type ContentKind, type Measurement, type VerifiedContent } from './content';
import { readImage, thumbnail, type ImageDraft } from './images';
import { RasterPreview, ReceivedFile } from './file-preview';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLink, DEFAULT_PLAYBACK_GAIN, describeError } from './audio';
import { signalDescription, type AudioDiagnostics } from './audio-diagnostics';
import { Calibration } from './calibration';
import { registerOffline, type OfflineState } from './pwa';
import { AUDIBLE_PROFILES, byteLength, createModem, decodeBinaryFixture, type AudibleProfile } from './modem';
import { decodePacket, Kind, MAX_TRANSFER_BYTES, MAX_PAYLOAD } from './protocol';
import { StopAndWait, type Events, type PacketEvent } from './transport';
import { SignalView, type SignalFrame } from './signal-view';
import { active, duration, RunProgress, type DeliveryProof, type Session, type Progress } from './components/sodium/blocks/run-progress';
import { simulateTransfer } from './simulation';
import { readWav, writeWav } from './wav';
import { Activity, ArrowUpRight, Icon } from './components/sodium/icon';
import { Alert, AlertDescription, AlertTitle } from './components/sodium/ui/alert';
import { Button } from './components/sodium/ui/button';
import { Checkbox } from './components/sodium/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './components/sodium/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './components/sodium/ui/empty-state';
import { Frame, FrameBody, FrameDescription, FrameHeader, FrameStatus, FrameTitle, FrameValue } from './components/sodium/ui/frame';
import { SegmentedControl, SegmentedControlItem } from './components/sodium/ui/segmented-control';
import { NativeSelect } from './components/sodium/ui/select';
import { Slider } from './components/sodium/ui/slider';
import { Status } from './components/sodium/ui/status';
import { Textarea } from './components/sodium/ui/textarea';
import { SodiumPortalProvider } from './lib/sodium/portal';
import './components/sodium/styles.css';
import './style.css';
import './instrument.css';

type Mode = 'microphone' | 'simulation';
type Receipt = { file?: VerifiedContent; text: string; source: string; time: string; id: number };
function resampleSpeech(pcm: Float32Array, rate: number) {
  const length = Math.floor(pcm.length * 16000 / rate), output = new Float32Array(length), step = rate / 16000;
  for (let i = 0; i < length; i++) { const at = i * step, lo = Math.floor(at), mix = at - lo; output[i] = (pcm[lo] ?? 0) * (1 - mix) + (pcm[Math.min(lo + 1, pcm.length - 1)] ?? 0) * mix; }
  return output;
}
type ColorTheme = 'system' | 'light' | 'dark';
const themePreferenceKey = 'sonicbridge-color-theme';

function colorTheme(value: string | null): ColorTheme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function ThemePicker() {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    try { return colorTheme(localStorage.getItem(themePreferenceKey)); }
    catch { return 'system'; }
  });

  useLayoutEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme;
      const chrome = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (chrome) chrome.content = getComputedStyle(document.body).getPropertyValue('--page').trim();
    };
    apply();
    if (theme === 'system') {
      system.addEventListener('change', apply);
      return () => system.removeEventListener('change', apply);
    }
  }, [theme]);

  return <div className="theme-picker">
    <label htmlFor="color-theme" className="type-label-sm">Theme</label>
    <NativeSelect id="color-theme" value={theme} onChange={event => {
      const choice = colorTheme(event.target.value);
      setTheme(choice);
      try { localStorage.setItem(themePreferenceKey, choice); } catch { /* The current tab can still switch themes. */ }
    }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </NativeSelect>
  </div>;
}

function App() {
  const [audioLink] = useState(() => new AudioLink());
  const link = useRef(audioLink);
  const transport = useRef<StopAndWait | undefined>(undefined);
  const sendAbort = useRef<AbortController | undefined>(undefined);
  const calibration = useRef<Calibration | undefined>(undefined);
  const [role, setRole] = useState<'send' | 'receive'>('send');
  const [playing, setPlaying] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const operationGeneration = useRef(0);
  const [calibrationStatus, setCalibrationStatus] = useState('');
  const [armed, setArmed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostics>(link.current.diagnostics);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDevice, setInputDevice] = useState(''), [outputDevice, setOutputDevice] = useState('');
  const [volume, setVolume] = useState(DEFAULT_PLAYBACK_GAIN);
  const [offline, setOffline] = useState<OfflineState>({ message: 'Preparing offline app…' });
  const [mode, setMode] = useState<Mode>('microphone');
  const [operating, setOperating] = useState<OperatingMode>('Balanced');
  const [profile, setProfile] = useState<AudibleProfile>('Audible Fast');
  const [shortTextEnabled, setShortTextEnabled] = useState(false);
  const [stats, setStats] = useState<ControllerSnapshot>();
  const [ready, setReady] = useState(false), [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [text, setText] = useState('');
  const [speechStatus, setSpeechStatus] = useState('idle');
  const [notice, setNotice] = useState('Start audio to prepare the local modem.');
  const [, setLevel] = useState(0), [receipts, setReceipts] = useState<Receipt[]>([]);
  const [fixture, setFixture] = useState<{ pcm: Float32Array; sampleRate: number }>();
  const [kind, setKind] = useState<ContentKind>('text');
  const [original, setOriginal] = useState<ImageDraft>();
  const [image, setImage] = useState<ImageDraft>();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array }>();
  const [previewId, setPreviewId] = useState<number>();
  const [progress, setProgress] = useState<Progress>();
  const [measurement, setMeasurement] = useState<Measurement>();
  const [replying, setReplying] = useState(false);
  const [session, setSession] = useState<Session>();
  const [packets, setPackets] = useState<PacketEvent[]>([]);
  const [initialEta, setInitialEta] = useState<number>();
  const frame = useRef<SignalFrame | undefined>(undefined), lastPlot = useRef(-Infinity);
  const recording = useRef<{ pcm: Float32Array; rate: number; used: number } | undefined>(undefined);
  const speechCapture = useRef<{ pcm: Float32Array; rate: number; used: number; resolve: (pcm: { pcm: Float32Array; rate: number }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const speechWorker = useRef<Worker | undefined>(undefined);
  const speechRequestId = useRef(0);
  const speechPending = useRef<{ id: number; resolve: (text: string) => void; reject: (error: Error) => void } | undefined>(undefined);
  const [recordState, setRecordState] = useState<'off' | 'recording' | 'captured'>('off');
  function discardCapture() { recording.current = undefined; setRecordState('off'); }
  function sample(pcm: Float32Array, rate: number, source: string) {
    const time = performance.now();
    if (source === 'Microphone' && (link.current.playbackSeconds !== undefined || time - lastPlot.current < 250)) return;
    lastPlot.current = time;
    const offset = Math.max(0, Math.floor((pcm.length - 2048) / 2));
    frame.current = { pcm: pcm.slice(offset, offset + 2048), rate, source };
  }
  function outgoing(pcm: Float32Array, rate: number, source: string) {
    sample(pcm, rate, source); setFixture({ pcm, sampleRate: rate });
  }
  function endMonitor() {
    setSession(old => old && active(old.phase) ? { ...old, phase: 'cancelled', last: old.virtual ? old.last : performance.now() } : old);
  }
  function recordProgress(acked: number, total: number, at: number) {
    setProgress(old => {
      const delta = old && old.at !== undefined && at > old.at && acked > old.acked
        ? 1000*(acked-old.acked)/(at-old.at) : undefined;
      return { acked, total, at, rate: delta && old?.rate ? (delta+old.rate)/2 : delta };
    });
  }
  const monitorEvents: Pick<Events, 'state' | 'packet' | 'policy' | 'reassembled' | 'receiveStarted'> = {
    state(phase, detail, at) {
      setNotice(detail);
      if (phase === 'negotiating' || phase === 'receiving') {
        setSession(old => phase === 'receiving' && old?.phase === 'receiving' ? old : { start: at, last: at, phase, receive: phase === 'receiving', virtual: mode === 'simulation', profile: link.current.playbackProfile, policy: 'Balanced', retries: 0 });
      } else setSession(old => old && ({ ...old, phase, last: at }));
      if (phase === 'receiving') setInitialEta(undefined);
      if (phase === 'failed') setError(detail);
    },
    packet(event) {
      if (event.direction !== 'submit') setAwaitingReply(false);
      setPackets(old => [...old.slice(-39), event]);
      setSession(old => old && active(old.phase) ? { ...old, last: event.at,
        retries: old.retries + Number(event.direction === 'submit' && (event.attempt ?? 1) > 1) } : old);
    },
    policy(policy) { setSession(old => old && ({ ...old, policy })); },
    receiveStarted(size) { setProgress(size === undefined ? undefined : { acked: 0, total: size }); },
    reassembled: recordProgress,
  };
  const draft = kind === 'image' ? image : file;
  const count = kind === 'text' ? byteLength(text) : draft?.bytes.length ?? 0;
  const name = safeName(kind === 'text' ? 'message.txt' : draft?.name ?? 'attachment');
  const metadata = manifestSize(name), capacity = MAX_TRANSFER_BYTES - metadata;
  const valid = (kind === 'text' ? count > 0 : !!draft) && count <= capacity;
  const shortTextBudget = MAX_PAYLOAD - metadata;
  const shortText = shortTextEnabled && kind === 'text' && count > 0 && count <= shortTextBudget;
  const measured = mode === 'microphone' && !shortText ? measurement : undefined;
  const robustEstimate = operating === 'Robust' || (operating === 'Adaptive' && mode === 'microphone' && stats?.target === 'Robust');
  const estimate = estimateTransfer(count + metadata, measured?.chunk, robustEstimate, { shortText, profile });
  const oneChunkBudget = (measured?.chunk ?? MAX_PAYLOAD) - metadata;
  const seconds = measured ? estimate.seconds * measured.elapsed / measured.modelSeconds : estimate.seconds;
  function resetDraft() { setOriginal(undefined); setImage(undefined); setFile(undefined); }
  async function choose(selected: File) {
    resetDraft();
    if (kind === 'image') { const source = await readImage(selected); setOriginal(source); setImage(source); }
    else {
      if (selected.size > MAX_TRANSFER_BYTES - manifestSize(selected.name)) throw new Error('File and manifest exceed the 4096-byte transfer limit.');
      setFile({ name: selected.name, bytes: new Uint8Array(await selected.arrayBuffer()) });
    }
  }
  useEffect(() => {
    const audio = link.current;
    audio.onCapture = (pcm, rate) => {
      sample(pcm, rate, 'Microphone');
      const speech = speechCapture.current;
      if (speech) {
        const n = Math.min(pcm.length, speech.pcm.length - speech.used);
        speech.pcm.set(pcm.subarray(0, n), speech.used); speech.used += n;
        if (speech.used === speech.pcm.length) { speechCapture.current = undefined; clearTimeout(speech.timer); speech.resolve({ pcm: speech.pcm, rate: speech.rate }); }
      }
      const rec = recording.current;
      if (!rec || rec.used === rec.pcm.length) return;
      const n = Math.min(pcm.length, rec.pcm.length - rec.used);
      rec.pcm.set(pcm.subarray(0,n), rec.used); rec.used += n;
      if (rec.used === rec.pcm.length) setRecordState('captured');
    };
    audio.onDiagnostics = setDiagnostics; audio.onDevices = setDevices;
    audio.onInterrupted = reason => {
      if (speechCapture.current) { clearTimeout(speechCapture.current.timer); speechCapture.current.reject(new Error(reason)); speechCapture.current = undefined; }
      discardCapture(); setReplying(false); frame.current = undefined; endMonitor();
      operationGeneration.current++; setBusy(''); setStats(undefined); setMeasurement(undefined);
      calibration.current?.dispose(); calibration.current = undefined; setArmed(false);
      transport.current?.dispose(); transport.current = undefined;
      sendAbort.current?.abort(new Error(reason)); setReady(false); setListening(false); setLevel(0); setError(reason);
      setCalibrationStatus('Audio interrupted. Start Audio, listen, and recalibrate after selecting your route.');
    };
    const unregister = registerOffline(setOffline, () => { calibration.current?.dispose(); transport.current?.dispose(); sendAbort.current?.abort(); audio.stop(); });
    return () => { unregister(); audio.onCapture = undefined; recording.current = undefined; speechWorker.current?.terminate(); speechWorker.current = undefined; speechPending.current?.reject(new Error('Speech recognition stopped.')); speechPending.current = undefined; calibration.current?.dispose(); calibration.current = undefined; transport.current?.dispose(); transport.current = undefined; sendAbort.current?.abort(); audio.stop(); audio.onDiagnostics = undefined; audio.onInterrupted = undefined; audio.onDevices = undefined; };
  }, []);
  function receive(message: string, source: string, file?: VerifiedContent) {
    setReceipts(items => [{ text: message, source, file, time: new Date().toLocaleTimeString(), id: Date.now() + Math.random() }, ...items].slice(0, 20));
  }
  function showProof(proof: DeliveryProof) {
    setSession(current => current && { ...current, proof });
  }
  async function run(label: string, action: () => Promise<void>) {
    const generation = operationGeneration.current;
    setBusy(label); setError('');
    try { await action(); } catch (e) { if (generation === operationGeneration.current) setError(describeError(e)); } finally { if (generation === operationGeneration.current) setBusy(''); }
  }
  async function dictateOffline() {
    if (!ready) throw new Error('Start Audio first, then allow microphone access.');
    if (!link.current.listening) await listen();
    const rate = link.current.sampleRate;
    if (!rate || rate < 16000) throw new Error('The active audio device sample rate is too low for speech recognition.');
    setSpeechStatus('Recording 5 seconds…');
    const captured = await new Promise<{ pcm: Float32Array; rate: number }>((resolve, reject) => {
      const timer = setTimeout(() => { speechCapture.current = undefined; reject(new Error('Microphone capture timed out. Check the input device and try again.')); }, 12000);
      speechCapture.current = { pcm: new Float32Array(rate * 5), rate, used: 0, resolve, reject, timer };
    });
    const pcm = resampleSpeech(captured.pcm, captured.rate), id = ++speechRequestId.current;
    const worker = speechWorker.current ??= new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' });
    setSpeechStatus('Transcribing on this device…');
    return new Promise<void>((resolve, reject) => {
      speechPending.current = { id, resolve: transcript => { setText(transcript); setSpeechStatus('Transcript ready. Edit it, then send.'); resolve(); }, reject };
      worker.onmessage = ({ data }: MessageEvent<{ id: number; text?: string; error?: string; progress?: { status?: string; file?: string } }>) => {
        if (data.id !== id) return;
        if (data.progress) { setSpeechStatus(data.progress.file ? `Loading local model · ${data.progress.file}` : 'Loading local speech model…'); return; }
        speechPending.current = undefined;
        if (data.error) { worker.terminate(); speechWorker.current = undefined; setSpeechStatus('Local transcription failed.'); reject(new Error(data.error)); }
        else if (data.text) { setText(data.text); setSpeechStatus('Transcript ready. Edit it, then send.'); resolve(); }
        else { setSpeechStatus('No speech recognized. Try again.'); reject(new Error('No speech was recognized.')); }
      };
      worker.onerror = event => { speechPending.current = undefined; worker.terminate(); speechWorker.current = undefined; setSpeechStatus('Local transcription failed.'); reject(new Error(event.message || 'Local speech worker failed.')); };
      worker.postMessage({ id, pcm }, [pcm.buffer]);
    });
  }
  function prepareTransport() {
    transport.current ??= new StopAndWait(link.current, undefined, {
      controller: setStats,
      ...monitorEvents, replying: setReplying,
      diagnostic: detail => setNotice(detail),
      content: item => {
        receive(item.text ?? item.name, 'MICROPHONE / VERIFIED · SHA-256', item);
        showProof('content-verified');
      },
      deliver: bytes => {
        try {
          if (calibration.current?.handle(bytes)) return;
          receive(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'MICROPHONE / VERIFIED');
          showProof('legacy-verified');
        }
        catch (error) { setError(`Verified binary transfer is not valid UTF-8 text: ${describeError(error)}`); }
      },
    });
    transport.current.controller.select(operating);
    calibration.current ??= new Calibration(transport.current, () => {
      const d = link.current.diagnostics, s = d.signal;
      return { sampleRate: d.contextRate ?? 48000, rms: s?.rms ?? 0, peak: s?.peak ?? 0,
        flags: (s && s.silenceSeconds >= 3 ? 1 : 0) | (s?.clipped ? 2 : 0) | (!s ? 4 : 0) | (d.processing.some(line => !line.endsWith('reports off.')) ? 8 : 0) };
    }, (detail, isArmed) => { setCalibrationStatus(detail); setArmed(isArmed); });
  }
  async function start() {
    await link.current.start();
    link.current.onWaveform = (pcm, rate) => {
      setPlaying(true); setAwaitingReply(false); setFixture({ pcm, sampleRate: rate });
      frame.current = { pcm, rate, source: 'Speaker playback', position: () => link.current.playbackSeconds };
    };
    link.current.onPlaybackEnd = () => { setPlaying(false); setAwaitingReply(true); frame.current = undefined; };
    prepareTransport(); setReady(true); setNotice(`Audio ready · ${link.current.sampleRate} Hz · ${link.current.playbackProfile} · ${MAX_PAYLOAD}-byte DATA payload`);
  }
  function stopListening() {
    discardCapture(); setReplying(false); endMonitor(); frame.current = undefined;
    calibration.current?.dispose(); calibration.current = undefined; setArmed(false);
    setCalibrationStatus('');
    transport.current?.dispose(); transport.current = undefined;
    link.current.stopListening(); setStats(undefined); setMeasurement(undefined); setListening(false); setLevel(0);
  }
  async function listen() {
    prepareTransport();
    await link.current.listen(setLevel, e => { discardCapture(); setReplying(false); calibration.current?.dispose(); calibration.current = undefined; setArmed(false); transport.current?.dispose(); transport.current = undefined; setError(describeError(e)); setListening(false); setLevel(0); });
    setListening(true);
  }
  function switchMode(next: Mode) {
    if (next === mode) return;
    setRole('send');
    stopListening(); setSession(undefined); setPackets([]); setProgress(undefined); setInitialEta(undefined); setFixture(undefined); setStats(undefined); setMeasurement(undefined); setMode(next); setError('');
    setNotice(next === 'simulation' ? 'Simulation exchanges binary packets through real generated PCM. No microphone, speaker, or network is used.' : 'Both peers must listen for acoustic capabilities and ACKs. Received text appears only after verified FIN completion.');
  }
  async function send() {
    if (sendAbort.current) return;
    setAwaitingReply(false);
    const body = packContent(kind, name, kind === 'text' ? new TextEncoder().encode(text) : draft!.bytes);
    setInitialEta(seconds);
    let negotiated = MAX_PAYLOAD;
    const options = { content: true, shortText, acknowledged(bodyBytes: number, chunk: number, at: number) {
      negotiated = chunk;
      recordProgress(Math.max(0, bodyBytes - metadata), count, at);
    } };
    const abort = sendAbort.current = new AbortController();
    setSession(undefined);
    setPackets([]);
    setProgress({ acked: 0, total: count });
    try {
      if (mode === 'microphone') {
        if (!link.current.listening) await listen();
        abort.signal.throwIfAborted();
        const start = performance.now();
        await transport.current!.send(body, options);
        const elapsed = (performance.now() - start) / 1000;
        if (count && !shortText) setMeasurement({ goodput: count / elapsed, chunk: negotiated, elapsed, modelSeconds: estimateTransfer(body.length, negotiated, robustEstimate, { profile }).seconds });
      } else {
        setNotice('Awaiting verified PCM delivery.');
        await simulateTransfer(body, { monitor: monitorEvents, mode: operating, profile, controller: setStats, sendOptions: options, content: item => receive(item.text ?? item.name, 'SIMULATION / PCM / VERIFIED · SHA-256', item), signal: abort.signal, waveform: (pcm, rate) => outgoing(pcm, rate, 'Simulation PCM') });
        setNotice('Simulated transfer confirmed by FIN_ACK through the real WASM/PCM codec. Physical-device testing pending.');
      }
      showProof('acknowledged');
    } finally { if (sendAbort.current === abort) sendAbort.current = undefined; }
  }
  async function importFixture(file: File) {
    if (file.size > 20 * 1024 * 1024) throw new Error('WAV fixture exceeds the 20 MB debugging limit.');
    const wav = readWav(await file.arrayBuffer());
    const modem = await createModem(wav.sampleRate);
    try {
      const decoded = decodeBinaryFixture(modem, wav.pcm);
      if (!decoded.length) throw new Error('No ggwave message decoded from this WAV. Check protocol, volume, and the complete recording.');
      decoded.map(bytes => decodePacket(bytes)).forEach(p => receive(`${Kind[p.kind]} · session ${p.session} · transfer ${p.transfer} · sequence ${p.seq} · ${p.payload.length} payload bytes`, 'WAV FIXTURE / PACKET INSPECTION'));
      setFixture(wav); setNotice(`Imported ${file.name} · ${wav.sampleRate} Hz. WAV import is a local debugging path.`);
    } finally { modem.dispose(); }
  }
  function exportFixture(wave = fixture, filename = 'sonicbridge-fixture.wav') {
    if (!wave) return;
    const url = URL.createObjectURL(new Blob([writeWav(wave.pcm, wave.sampleRate)], { type: 'audio/wav' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function cancelTransfer() {
    calibration.current?.cancel();
    transport.current?.cancel();
    sendAbort.current?.abort(new Error('Transfer cancelled.'));
  }
  const running = active(session?.phase);
  const physical = mode === 'microphone';
  const hint = /timed out|timeout/i.test(error) ? 'Check that the other device is listening. Enable both microphones, turn up the receiving device’s speaker for replies, and retry.' : '';
  return <main>
    <a className="skip" href="#workspace">Skip to transfer controls</a>
    <header className="mast">
      <a className="brand" href="." aria-label="Sonicbridge home"><span className="brand-mark"><Icon icon={Activity}/></span><span className="type-label-lg">Sonicbridge</span></a>
      <div className="mast-meta"><span>SW–41 <b>/</b> Acoustic data link</span><ThemePicker/></div>
    </header>
    <div className="heading">
      <div><h1>Connect through sound</h1><p>Send messages, images, and small files between nearby devices using their speakers and microphones.</p></div>
      <div className="mode-picker">
        <span className="type-label-sm" id="transport-mode">Transport mode</span>
        <SegmentedControl className="mode-options" aria-labelledby="transport-mode" value={mode} disabled={!!busy || running} onValueChange={value => {
          if (value === 'microphone' || value === 'simulation') switchMode(value);
        }}>
          <SegmentedControlItem value="microphone">Physical Audio</SegmentedControlItem>
          <SegmentedControlItem value="simulation">Simulation · local PCM</SegmentedControlItem>
        </SegmentedControl>
      </div>
    </div>
    <div className="console-grid" id="workspace" tabIndex={-1}><div className="task-column">
    <Frame className="setup">
    <FrameHeader>
      <FrameTitle>{physical ? 'Audio setup' : 'Local simulation'}</FrameTitle>
      <FrameStatus><Status size="sm" status={ready ? 'ok' : 'idle'}>{listening ? 'Mic open' : ready ? 'Audio ready' : 'Audio off'}</Status></FrameStatus>
    </FrameHeader>
    <FrameBody>
    <FrameDescription>{physical ? 'Start audio on this device, then choose Send or Receive.' : 'Run both endpoints here using generated PCM and a virtual clock. Your microphone and speaker are unused.'}</FrameDescription>
    {(physical || offline.update) && <div className="offline-readiness">
      <Status size="sm" status={offline.ready ? 'ok' : 'idle'}>Offline setup</Status>
      <p className="fine">{offline.message}</p>
      {offline.update && <Button variant="secondary" onClick={offline.update}>Stop audio &amp; update app</Button>}
    </div>}
    <div className="actions"><Button variant={ready ? 'secondary' : 'primary'} disabled={!!busy || running} onClick={() => run('Starting audio…', start)}>{ready ? 'Resume Audio' : 'Start Audio'}</Button>
    {ready && <Button variant="secondary" onClick={() => { stopListening(); sendAbort.current?.abort(); link.current.stop(); setReady(false); setNotice('Audio stopped. Microphone released.'); }}>Stop Audio</Button>}</div>
    {physical && <Collapsible className="route">
      <CollapsibleTrigger>Check devices</CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <div className="device-controls">
          <div><label className="type-label-sm" htmlFor="microphone-device">Microphone</label><NativeSelect id="microphone-device" aria-label="Microphone device" disabled={listening || !!busy} value={inputDevice} onChange={e => { setInputDevice(e.target.value); link.current.inputDeviceId = e.target.value; }}><option value="">Browser default microphone</option>{devices.filter(d => d.kind === 'audioinput' && d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</NativeSelect></div>
          <div><label className="type-label-sm" htmlFor="output-device">Speaker</label><NativeSelect id="output-device" aria-label="Output device" disabled={listening || !!busy || !link.current.canSelectOutput} value={outputDevice} onChange={e => { const value = e.target.value; stopListening(); link.current.stop(); setReady(false); setOutputDevice(value); link.current.outputDeviceId = value; setNotice('Output choice saved. Tap Start Audio explicitly to apply it, then recalibrate.'); }}><option value="">Browser / OS default speaker</option>{devices.filter(d => d.kind === 'audiooutput' && d.deviceId).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${i + 1}`}</option>)}</NativeSelect></div>
          <div><span className="type-label-sm">Playback gain</span><Slider thumbLabels={['Playback gain']} disabled={!!busy} min={0.1} max={1} step={0.05} value={volume} showValue format={{ style: 'percent' }} onValueChange={value => {
            if (typeof value === 'number') { setVolume(value); link.current.setPlaybackGain(value); }
          }}/></div>
          <Button variant="secondary" disabled={!!busy} onClick={() => run('Listing devices…', async () => { await link.current.refreshDevices(); })}>Refresh devices</Button>
        </div>
        <p className="fine">Device labels may require microphone permission. Use the OS speaker picker when output selection is unavailable.</p>
      </CollapsibleContent>
    </Collapsible>}
    </FrameBody>
    </Frame>
    <Frame className="composer" data-engaging={!!sendAbort.current && !error} aria-label="Transfer controls">
    <FrameHeader><FrameTitle>Transfer controls</FrameTitle></FrameHeader>
    <FrameBody>
    <SegmentedControl fill aria-label="Transfer direction" value={role} disabled={!!busy || running} onValueChange={value => {
      if (value === 'send' || value === 'receive') setRole(value);
    }}>
      <SegmentedControlItem value="send">Send</SegmentedControlItem>
      <SegmentedControlItem value="receive">Receive</SegmentedControlItem>
    </SegmentedControl>
    <div><label className="type-label-sm" htmlFor="playback-profile">Playback profile</label><NativeSelect id="playback-profile" value={profile} disabled={!!busy || running || replying} onChange={e => {
      const selected = e.target.value as AudibleProfile;
      link.current.playbackProfile = selected;
      setProfile(selected);
      setMeasurement(undefined);
    }}>{Object.keys(AUDIBLE_PROFILES).map(option => <option key={option}>{option}</option>)}</NativeSelect></div>
    {physical && <div className="role-guide">
      <p>{role === 'send' ? 'On the other device, choose Receive and start listening. Your microphone listens for its replies.' : 'Start listening here, then send from the other device. Keep this screen awake so your speaker can reply.'}</p>
      <p className="fine">{listening ? 'Microphone open' : /denied/i.test(diagnostics.permission) ? 'Microphone blocked. Allow access in site settings and try again.' : 'Microphone closed. Allow access when the browser asks.'}</p>
      <Collapsible className="link-check">
        <CollapsibleTrigger summary="Optional">Check link</CollapsibleTrigger>
        <CollapsibleContent keepMounted>
        <p>{role === 'receive' ? 'Arm this device, then choose Calibrate link on the sender.' : 'Arm the receiver on the other device first. Then run a challenge and reply through sound.'}</p>
        {role === 'receive' ? <Button variant="secondary" disabled={!ready || !!busy || running || replying} aria-pressed={armed} onClick={() => run('Arming calibration…', async () => {
          if (!link.current.listening) await listen();
          calibration.current!.arm();
        })}>{armed ? 'Calibration receiver armed' : 'Arm calibration receiver'}</Button>
          : <Button variant="secondary" disabled={!ready || !!busy || running || replying} onClick={() => run('Calibrating acoustic link…', async () => {
            if (!link.current.listening) await listen();
            await calibration.current!.run();
          })}>Calibrate link</Button>}
        {calibrationStatus && <p className="calibration-status" aria-live="polite">{calibrationStatus}</p>}
        </CollapsibleContent>
      </Collapsible>
    </div>}
    <div className="send-panel" id="send" hidden={role!=='send'}>
    <SegmentedControl fill aria-label="Transfer type" value={kind} disabled={!!busy || running} onValueChange={value => {
      if (value === 'text' || value === 'image' || value === 'file') { resetDraft(); setError(''); setKind(value); }
    }}>
      <SegmentedControlItem value="text">Text</SegmentedControlItem>
      <SegmentedControlItem value="image">Image</SegmentedControlItem>
      <SegmentedControlItem value="file">Small file</SegmentedControlItem>
    </SegmentedControl>
        {kind === 'text' ? <><label className="type-label-sm" htmlFor="message">What would you like to send?</label>
          <div className="actions"><Button variant="secondary" disabled={!ready || !!busy || running} onClick={() => void run('Recording and transcribing locally…', dictateOffline)}>Speak to fill message</Button>
            <span className="fine">{speechStatus === 'idle' ? 'Offline English model · first use loads about 42 MB from this app. Audio is processed on this device.' : speechStatus} Review or edit the transcript before sending.</span></div>
          <Textarea id="message" rows={5} resizable placeholder="Type or dictate a message…" disabled={!!busy} maxLength={MAX_TRANSFER_BYTES} value={text} onChange={e => { setText(e.target.value); }} spellCheck={false}/></> :
          <><label className="type-label-sm" htmlFor="transfer-file">{kind === 'image' ? 'Select PNG or JPEG' : 'Select a small file'}</label>
          {/* eslint-disable-next-line sodium/no-native-control -- The native browser chooser reads local files without sending them over the network. */}
          <input id="transfer-file" key={kind} type="file" disabled={!!busy} accept={kind === 'image' ? 'image/png,image/jpeg' : undefined} onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void run('Reading local file…', () => choose(selected)); }}/>
          {draft && <p className="file-details">{name} · {count} encoded bytes</p>}
          {kind === 'image' && image && original && <><RasterPreview bytes={image.bytes} mime={image.raster.mime}/><p>{image.raster.width} × {image.raster.height} px · {image.thumbnail ? 'Thumbnail copy' : 'Original bytes'}</p>
            <Button variant="secondary" disabled={!!busy || image.thumbnail} onClick={() => run('Making thumbnail…', async () => { setImage(await thumbnail(original)); })}>Make 1–3 KiB thumbnail</Button>
            {image.thumbnail && <><p>{count >= 1024 && count <= 3072 ? 'Within' : count < 1024 ? 'Below' : 'Above'} target of 1024–3072 bytes · actual {count} bytes</p><Button variant="secondary" disabled={!!busy} onClick={() => { setImage(original); }}>Use original</Button></>}</>}</>}

    {kind === 'text' && <div>
      <label className="checkbox-label"><Checkbox checked={shortTextEnabled} disabled={!!busy || running || replying} onCheckedChange={setShortTextEnabled} /> Use short-text fast path</label>
      {shortTextEnabled && <p className="fine">Uses one message and one verified reply with an updated receiver. Text over {shortTextBudget} UTF-8 bytes uses the standard transfer.</p>}
    </div>}
    <p className={count > capacity ? 'invalid' : 'fine'}>{count.toLocaleString()} / {capacity.toLocaleString()} content bytes{count > capacity && ' · exceeds transfer limit'}</p>
    <div className="actions"><Button className="send-button" title={!ready ? 'Start Audio first' : !valid ? 'Choose content within the size limit' : replying ? 'Returning an acoustic reply' : undefined} disabled={!ready || !valid || !!busy || running || replying} onClick={() => { if (!sendAbort.current) void run(physical ? 'Acoustic transfer…' : 'PCM protocol simulation…', send); }}>{physical ? 'Start transmission' : 'Run PCM simulation'}<Icon icon={ArrowUpRight}/></Button>
    {(sendAbort.current || running) && <Button variant="secondary" onClick={cancelTransfer}>Cancel transfer</Button>}</div>
    {valid && <p className="fine">~{duration(seconds)} estimated · {shortText ? '2 acoustic packets' : `${estimate.count} DATA chunks`} · {measured ? 'scaled from previous transfer' : 'modeled without retries'}.</p>}
    {valid && physical && estimate.count > 1 && <p className="fine">{oneChunkBudget > 0 ? `Keep content to ${oneChunkBudget} bytes for a single chunk. ` : ''}Each additional chunk needs its own acoustic reply.</p>}
    </div>
    <div className="receive-panel" id="receive" hidden={role!=='receive'}>
    <h3>{!physical ? 'Simulated receiver' : !listening ? 'Receiver offline' : replying ? 'Returning acoustic reply' : running ? 'Link in use' : 'Listening for a nearby sender'}</h3>
    <p>{physical ? 'Keep this page open. The microphone listens for data and the speaker returns acknowledgements.' : 'The local receiver verifies the reconstructed payload before displaying it below.'}</p>
    {mode === 'microphone' && <Button variant={listening ? 'secondary' : 'primary'} disabled={!ready || !!busy || running} onClick={() => {
        if (listening) { stopListening(); return; }
        void run('Requesting microphone…', async () => { await listen(); setNotice('Listening for v1 acoustic packets. Replies use this device’s playback profile.'); });
      }}>{listening ? 'Stop listening' : 'Listen with microphone'}</Button>}
    {running && <Button variant="secondary" onClick={cancelTransfer}>Cancel transfer</Button>}
    <p className="input-diagnostic">{physical && listening ? signalDescription(diagnostics.signal) : ''}</p>
    </div>
    {!ready && <p className="fine">Start Audio to enable transfer controls.</p>}
    </FrameBody>
    </Frame>
    {busy && <p className="action-state">{busy}</p>}
    {error && <Alert status="fail"><AlertTitle>Link needs attention</AlertTitle><AlertDescription>{error} {hint}</AlertDescription></Alert>}
    </div>
    <div className="telemetry-column">
    <SignalView key={mode} frame={frame} live={playing || listening || !!sendAbort.current} verified={!busy && !error && !!session?.proof} caption={playing ? 'Speaker playback' : awaitingReply && running && !session?.receive ? 'Waiting for acknowledgement' : listening ? 'Microphone open' : physical ? 'Physical Audio' : 'Simulation PCM'} />
    <RunProgress session={session} events={packets} progress={progress} simulated={!physical} estimate={session?.receive ? undefined : initialEta}/>
    <Frame className="results">
      <FrameHeader><FrameTitle>Results</FrameTitle><FrameValue meta>{receipts.length} {receipts.length === 1 ? 'entry' : 'entries'}</FrameValue></FrameHeader>
      <FrameBody padding={receipts.length ? 'default' : 'none'}>
        <div className="inbox" aria-live="polite">{receipts.length ? receipts.map(item =>
          <article key={item.id}>
            <div><span>{item.source}</span><time>{item.time}</time></div>
            {item.file && item.file.kind !== 'text'
              ? <ReceivedFile item={item.file} preview={previewId === item.id} select={() => setPreviewId(previewId === item.id ? undefined : item.id)}/>
              : <p>{item.text}</p>}
          </article>
        ) : <Empty variant="plain" size="sm"><EmptyHeader><EmptyTitle>No results yet</EmptyTitle><EmptyDescription>{physical ? 'Verified microphone transfers appear here.' : 'Run a simulation to decode generated audio.'}</EmptyDescription></EmptyHeader></Empty>}</div>
      </FrameBody>
    </Frame></div>
    </div>
    {running && session && session.retries >= 2 && <Alert className="retry-alert" status="warn"><AlertTitle>Repeated missing replies</AlertTitle><AlertDescription>Check that the peer is listening and that its speaker can reach this microphone.</AlertDescription></Alert>}
    <div className="feedback" role="status">{busy ? busy+' ' : ''}{notice}</div>
    <Frame className="tech">
    <Collapsible>
    <CollapsibleTrigger>Technical details</CollapsibleTrigger>
    <CollapsibleContent keepMounted>
    <div className="tech-body">
          <section className="controller-panel" aria-label="Link controller">
        <div><label className="type-label-sm" htmlFor="operating-mode">Operating mode</label><NativeSelect id="operating-mode" value={operating} disabled={!!busy} onChange={e => {
          const selected = e.target.value;
          if (selected !== 'Balanced' && selected !== 'Robust' && selected !== 'Adaptive') return;
          setOperating(selected); setMeasurement(undefined); setStats(undefined);
          if (mode === 'microphone') transport.current?.controller.select(selected);
        }}><option>Balanced</option><option>Robust</option><option>Adaptive</option></NativeSelect></div>
        <p>{operating === 'Balanced' ? '500 ms DATA and ACK guards. Up to four DATA attempts.' :
          operating === 'Robust' ? '900 ms DATA and ACK guards. Up to six DATA attempts after acoustic agreement.' :
          'Starts Balanced. Repeated ACK loss requests Robust. Eight clean first-attempt ACKs and a 30 s dwell allow recovery.'}</p>
        {stats && <><p>{mode === 'microphone' ? 'Microphone' : 'Simulated PCM'} · sender target {stats.target}</p>
          <p>Last {stats.attempts} resolved DATA attempts · ACKs {stats.acks} · timeouts {stats.attempts - stats.acks} · retries {stats.retries}
            {stats.attempts > 0 && ` (ACK ${Math.round(100 * stats.acks/stats.attempts)}%, timeout ${Math.round(100 * (1 - stats.acks/stats.attempts))}%, retry ${Math.round(100 * stats.retries/stats.attempts)}%)`}</p>
          <p>Recent local modem outputs · valid packets {stats.decoded} · rejected packets {stats.rejected}
            {stats.confirmedBps !== undefined && ` · confirmed content goodput ${stats.confirmedBps.toFixed(2)} B/s`}</p>
          {stats.history.length > 0 && <Collapsible><CollapsibleTrigger>Controller decisions</CollapsibleTrigger><CollapsibleContent><ul>{stats.history.map((entry, i) => <li key={i}>{entry}</li>)}</ul></CollapsibleContent></Collapsible>}</>}
      </section>

    <section aria-label="Device diagnostics">
    <h2>Device diagnostics</h2>      <dl className="diagnostic-grid"><div><dt>Audio context</dt><dd>{diagnostics.contextState} · {diagnostics.contextRate ?? '—'} Hz</dd></div><div><dt>Microphone / capture graph</dt><dd>{diagnostics.trackRate ?? 'not reported'} / {diagnostics.signal?.sampleRate ?? diagnostics.contextRate ?? '—'} Hz</dd></div><div><dt>Permission</dt><dd>{diagnostics.permission}</dd></div><div><dt>Effective input</dt><dd>{diagnostics.inputLabel ?? 'not opened'}</dd></div></dl>
      <p className="input-diagnostic">{!listening && diagnostics.signal ? 'Last capture: ' : ''}{signalDescription(diagnostics.signal)}</p><p className="fine">{diagnostics.deviceNote} Track audio is converted by Web Audio to the graph rate; the modem handles conversion to its internal 48 kHz. Clipping is latched until input restarts.</p>
      <ul className="processing-report">{diagnostics.processing.map(line => <li key={line}>{line}</li>)}</ul>
    </section>

    <section className="fixtures"><h2>Diagnostic audio</h2><p>Export the latest outgoing packet or inspect a local WAV. Record a five-second microphone clip only when needed. Export saves a WAV. Discard or stop listening to clear the clip from memory.</p>
    <div className="actions"><Button variant="secondary" disabled={!fixture || !!busy} onClick={() => exportFixture()}>Export WAV</Button><div>
      <label className="type-label-sm" htmlFor="wav-file">Import WAV</label>
      {/* eslint-disable-next-line sodium/no-native-control -- WAV diagnostics import reads a user-selected local file. */}
      <input id="wav-file" type="file" accept=".wav,audio/wav" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value=''; if (f) void run('Decoding WAV…', () => importFixture(f)); }}/>
    </div></div>
    {physical && <div className="actions"><Button variant="secondary" disabled={!listening || recordState === 'recording'} onClick={() => { const rate=link.current.sampleRate; if (rate) { recording.current={pcm:new Float32Array(rate*5), rate, used:0}; setRecordState('recording'); } }}>Record 5 s of microphone</Button>
    {recordState !== 'off' && <><span>{recordState === 'recording' ? 'Recording microphone…' : '5 s captured'}</span><Button variant="secondary" onClick={discardCapture}>Discard recording</Button></>}
    {recordState === 'captured' && <Button variant="secondary" onClick={() => { const rec=recording.current; if (rec) exportFixture({ pcm: rec.pcm, sampleRate:rec.rate }, 'sonicbridge-microphone.wav'); }}>Export microphone WAV</Button>}</div>}</section>
    </div>
    </CollapsibleContent>
    </Collapsible>
    </Frame>
    <footer className="site-footer"><span>Sonicbridge</span><span>ggwave 0.4.0 · Protocol v1</span></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><SodiumPortalProvider><App/></SodiumPortalProvider></React.StrictMode>,
);
