import type { OperatingMode, ControllerSnapshot } from './controller';
import { estimateTransfer, manifestSize, packContent, safeName, type ContentKind, type Measurement, type VerifiedContent } from './content';
import { readImage, thumbnail, type ImageDraft } from './images';
import { RasterPreview, ReceivedFile } from './file-preview';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLink, DEFAULT_PLAYBACK_GAIN, describeError } from './audio';
import { signalDescription, type AudioDiagnostics } from './audio-diagnostics';
import { Calibration } from './calibration';
import { registerOffline, type OfflineState } from './pwa';
import { byteLength, createModem, decodeBinaryFixture } from './modem';
import { decodePacket, Kind, MAX_TRANSFER_BYTES, MAX_PAYLOAD } from './protocol';
import { StopAndWait, type Events, type PacketEvent } from './transport';
import { SignalView, type SignalFrame } from './signal-view';
import { active, duration, SessionMonitor, type Session, type Progress } from './session-monitor';
import { simulateTransfer } from './simulation';
import { readWav, writeWav } from './wav';

// Import SonicBridge Platform Services & Components
import { defaultAcousticBridge } from './bridge/acoustic-bridge';
import { getOrCreateDeviceIdentity } from './security/identity';
import type { DeviceIdentity } from './types/identity';
import { AudioVisualizerView } from './components/AudioVisualizerView';
import { RescueView } from './components/RescueView';
import { AirGapView } from './components/AirGapView';
import { TraceView } from './components/TraceView';
import { TrustView } from './components/TrustView';
import { AuditView } from './components/AuditView';
import { RelayQueueView } from './components/RelayQueueView';
import { AcousticTicker } from './components/AcousticTicker';
import { defaultRescueState } from './scenarios/rescue/state';
import { defaultAirGapState } from './scenarios/airgap/state';
import { defaultTraceState } from './scenarios/trace/state';
import type { IncidentReport } from './types/rescue';
import type { ConfigPackage } from './types/airgap';
import type { ShipmentRecord, HandoverEvent } from './types/trace';
import { HumanReadableReceipt } from './components/HumanReadableReceipt';


import './style.css';
import './instrument.css';
import './components/console.css';
import './lunar/theme.css';
import { MoonRelay } from './lunar/moon-view';
import { Navbar, Hero, Guide, Footer } from './lunar/shell';

type Mode = 'microphone' | 'simulation';
type Receipt = { file?: VerifiedContent; text: string; source: string; time: string; id: number };

function App() {
  const [audioLink] = useState(() => new AudioLink());
  const link = useRef(audioLink);
  const transport = useRef<StopAndWait | undefined>(undefined);
  const sendAbort = useRef<AbortController | undefined>(undefined);
  const calibration = useRef<Calibration | undefined>(undefined);

  // Identity & Multi-Scenario Navigation State
  const [localIdentity, setLocalIdentity] = useState<DeviceIdentity | null>(null);
  const [activeTab, setActiveTab] = useState<'transceiver' | 'rescue' | 'airgap' | 'trace' | 'visualizer' | 'trust' | 'relay' | 'audit'>('transceiver');
  const [speedMode, setSpeedMode] = useState<'fastest' | 'fast'>('fastest');

  const [role, setRole] = useState<'send' | 'receive'>('send');
  const [engagement, setEngagement] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const operationGeneration = useRef(0);
  const [calibrationStatus, setCalibrationStatus] = useState('On the other device, arm the calibration receiver first. Then calibrate from this device.');
  const [armed, setArmed] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AudioDiagnostics>(link.current.diagnostics);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputDevice, setInputDevice] = useState(''), [outputDevice, setOutputDevice] = useState('');
  const [volume, setVolume] = useState(DEFAULT_PLAYBACK_GAIN);
  const [offline, setOffline] = useState<OfflineState>({ message: 'Preparing offline app…' });
  const [mode, setMode] = useState<Mode>('microphone');
  const [operating, setOperating] = useState<OperatingMode>('Balanced');
  const [stats, setStats] = useState<ControllerSnapshot>();
  const [ready, setReady] = useState(false), [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [text, setText] = useState('');
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
        ? 1000 * (acked - old.acked) / (at - old.at) : undefined;
      return { acked, total, at, rate: delta && old?.rate ? (delta + old.rate) / 2 : delta };
    });
  }
  const monitorEvents: Pick<Events, 'state' | 'packet' | 'policy' | 'reassembled' | 'receiveStarted'> = {
    state(phase, detail, at) {
      setNotice(detail);
      if (phase === 'negotiating' || phase === 'receiving') {
        setSession(old => phase === 'receiving' && old?.phase === 'receiving' ? old : { start: at, last: at, phase, receive: phase === 'receiving', virtual: mode === 'simulation', policy: 'Balanced', retries: 0 });
      } else setSession(old => old && ({ ...old, phase, last: at }));
      if (phase === 'receiving') setInitialEta(undefined);
      if (phase === 'failed') setError(detail);
    },
    packet(event) {
      if (event.direction !== 'submit') setAwaitingReply(false);
      setPackets(old => [...old.slice(-39), event]);
      setSession(old => old && active(old.phase) ? {
        ...old, last: event.at,
        retries: old.retries + Number(event.direction === 'submit' && (event.attempt ?? 1) > 1)
      } : old);
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
  const measured = mode === 'microphone' ? measurement : undefined;
  const robustEstimate = operating === 'Robust' || (operating === 'Adaptive' && mode === 'microphone' && stats?.target === 'Robust');
  const estimate = estimateTransfer(count + metadata, measured?.chunk, robustEstimate, speedMode === 'fastest');
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
    // Initialize Local Cryptographic Device Identity
    void getOrCreateDeviceIdentity().then(keys => {
      setLocalIdentity(keys.identity);
      defaultAcousticBridge.setLocalIdentity(keys.identity.id, keys.publicKey, keys.privateKey);
    });

    const audio = link.current;
    audio.onCapture = (pcm, rate) => {
      sample(pcm, rate, 'Microphone');
      const rec = recording.current;
      if (!rec || rec.used === rec.pcm.length) return;
      const n = Math.min(pcm.length, rec.pcm.length - rec.used);
      rec.pcm.set(pcm.subarray(0, n), rec.used); rec.used += n;
      if (rec.used === rec.pcm.length) setRecordState('captured');
    };
    audio.onDiagnostics = setDiagnostics; audio.onDevices = setDevices;
    audio.onInterrupted = reason => {
      discardCapture(); setReplying(false); frame.current = undefined; endMonitor();
      operationGeneration.current++; setBusy(''); setStats(undefined); setMeasurement(undefined);
      calibration.current?.dispose(); calibration.current = undefined; setArmed(false);
      transport.current?.dispose(); transport.current = undefined;
      sendAbort.current?.abort(new Error(reason)); setReady(false); setListening(false); setLevel(0); setError(reason);
      setCalibrationStatus('Audio interrupted. Start Audio, listen, and recalibrate after selecting your route.');
    };
    const unregister = registerOffline(setOffline, () => { calibration.current?.dispose(); transport.current?.dispose(); sendAbort.current?.abort(); audio.stop(); });
    return () => { unregister(); audio.onCapture = undefined; recording.current = undefined; calibration.current?.dispose(); calibration.current = undefined; transport.current?.dispose(); transport.current = undefined; sendAbort.current?.abort(); audio.stop(); audio.onDiagnostics = undefined; audio.onInterrupted = undefined; audio.onDevices = undefined; };
  }, []);

  function receive(message: string, source: string, file?: VerifiedContent) {
    setReceipts(items => [{ text: message, source, file, time: new Date().toLocaleTimeString(), id: Date.now() + Math.random() }, ...items].slice(0, 20));

    // Pass through AcousticBridge for cryptographic verification, replay check, and scenario dispatch
    if (file) {
      void defaultAcousticBridge.handleReceivedContent(file).then(evt => {
        if (evt && evt.envelope && evt.verification.valid && !evt.isReplay) {
          const type = evt.envelope.messageType;
          if (type === 'rescue_incident') {
            defaultRescueState.addReport(evt.envelope.payload as IncidentReport);
            setNotice(`🚨 Received verified Rescue incident from ${evt.envelope.originDeviceId}`);
          } else if (type === 'airgap_package') {
            defaultAirGapState.addPackage(evt.envelope.payload as ConfigPackage);
            setNotice(`🔒 Received verified Air-Gap package from ${evt.envelope.originDeviceId}`);
          } else if (type === 'trace_handover') {
            defaultTraceState.addShipment(evt.envelope.payload as ShipmentRecord);
            setNotice(`📦 Received verified Trace shipment from ${evt.envelope.originDeviceId}`);
          } else if (type === 'trace_acceptance') {
            try {
              defaultTraceState.addHandover(evt.envelope.payload as HandoverEvent);
              setNotice(`📦 Received verified Custody Handover from ${evt.envelope.originDeviceId}`);
            } catch (e) {
              console.warn('Trace handover receive note:', e);
            }
          }
        } else if (evt && !evt.verification.valid) {
          setError(`Security Alert: Received unverified or tampered envelope: ${evt.error || 'INVALID_SIGNATURE'}`);
        } else if (evt && evt.isReplay) {
          setError(`Security Alert: Rejected replayed message: ${evt.error || 'DUPLICATE_MESSAGE_ID'}`);
        }
      });
    }
  }

  async function run(label: string, action: () => Promise<void>) {
    const generation = operationGeneration.current;
    setBusy(label); setError('');
    try { await action(); } catch (e) { if (generation === operationGeneration.current) setError(describeError(e)); } finally { if (generation === operationGeneration.current) setBusy(''); }
  }

  function prepareTransport() {
    transport.current ??= new StopAndWait(link.current, undefined, {
      controller: setStats,
      ...monitorEvents, replying: setReplying,
      diagnostic: detail => setNotice(detail),
      content: item => receive(item.text ?? item.name, 'MICROPHONE / VERIFIED · SHA-256', item),
      deliver: bytes => {
        try { if (calibration.current?.handle(bytes)) return; receive(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'MICROPHONE / VERIFIED'); }
        catch (error) { setError(`Verified binary transfer is not valid UTF-8 text: ${describeError(error)}`); }
      },
    });
    transport.current.controller.select(operating);
    transport.current.timing.guardMs = speedMode === 'fastest' ? 250 : (operating === 'Robust' ? 900 : 500);
    calibration.current ??= new Calibration(transport.current, () => {
      const d = link.current.diagnostics, s = d.signal;
      return {
        sampleRate: d.contextRate ?? 48000, rms: s?.rms ?? 0, peak: s?.peak ?? 0,
        flags: (s && s.silenceSeconds >= 3 ? 1 : 0) | (s?.clipped ? 2 : 0) | (!s ? 4 : 0) | (d.processing.some(line => !line.endsWith('reports off.')) ? 8 : 0)
      };
    }, (detail, isArmed) => { setCalibrationStatus(detail); setArmed(isArmed); });
  }

  async function start() {
    await link.current.start();
    await link.current.setProtocol(speedMode);
    link.current.onWaveform = (pcm, rate) => {
      setPlaying(true); setAwaitingReply(false); setFixture({ pcm, sampleRate: rate });
      frame.current = { pcm, rate, source: 'Speaker playback', position: () => link.current.playbackSeconds };
    };
    link.current.onPlaybackEnd = () => { setPlaying(false); setAwaitingReply(true); frame.current = undefined; };
    prepareTransport(); setReady(true); setNotice(`Audio ready · ${link.current.sampleRate} Hz · ${speedMode === 'fastest' ? '⚡ Turbo audible fastest (~4.3s/chunk)' : 'v1 baseline audible fast (~9.2s/chunk)'} · ${MAX_PAYLOAD}-byte DATA payload`);
  }

  function stopListening() {
    discardCapture(); setReplying(false); endMonitor(); frame.current = undefined;
    calibration.current?.dispose(); calibration.current = undefined; setArmed(false);
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
    const abort = sendAbort.current = new AbortController();
    setEngagement(value => value + 1); setAwaitingReply(false);
    const body = packContent(kind, name, kind === 'text' ? new TextEncoder().encode(text) : draft!.bytes);
    setInitialEta(seconds);
    let negotiated = MAX_PAYLOAD;
    const options = {
      content: true, acknowledged(bodyBytes: number, chunk: number, at: number) {
        negotiated = chunk;
        recordProgress(Math.max(0, bodyBytes - metadata), count, at);
      }
    };
    setProgress({ acked: 0, total: count });
    try {
      if (mode === 'microphone') {
        await link.current.setProtocol(speedMode);
        if (transport.current) transport.current.timing.guardMs = speedMode === 'fastest' ? 250 : (operating === 'Robust' ? 900 : 500);
        if (!link.current.listening) await listen();
        abort.signal.throwIfAborted();
        const start = performance.now();
        await transport.current!.send(body, options);
        const elapsed = (performance.now() - start) / 1000;
        if (count) setMeasurement({ goodput: count / elapsed, chunk: negotiated, elapsed, modelSeconds: estimateTransfer(body.length, negotiated, robustEstimate, speedMode === 'fastest').seconds });
      } else {
        setPackets([]); setSession(undefined); setNotice('Awaiting verified PCM delivery.');
        await simulateTransfer(body, { monitor: monitorEvents, mode: operating, controller: setStats, sendOptions: options, content: item => receive(item.text ?? item.name, 'SIMULATION / PCM / VERIFIED · SHA-256', item), signal: abort.signal, waveform: (pcm, rate) => outgoing(pcm, rate, 'Simulation PCM') });
        setNotice('Simulated transfer confirmed by FIN_ACK through the real WASM/PCM codec. Physical-device testing pending.');
      }
    } finally { if (sendAbort.current === abort) sendAbort.current = undefined; }
  }

  // Unified Scenario Acoustic Transmission Function
  async function sendScenarioPayload(body: Uint8Array, description: string) {
    if (sendAbort.current) return;
    const abort = sendAbort.current = new AbortController();
    setEngagement(value => value + 1);
    setAwaitingReply(false);
    setNotice(`Acoustic transmission: ${description}`);
    setProgress({ acked: 0, total: body.length });

    const options = {
      content: true,
      acknowledged(bodyBytes: number, chunk: number, at: number) {
        recordProgress(bodyBytes, body.length, at);
      }
    };

    try {
      if (mode === 'microphone') {
        await link.current.setProtocol(speedMode);
        if (transport.current) transport.current.timing.guardMs = speedMode === 'fastest' ? 250 : (operating === 'Robust' ? 900 : 500);
        if (!ready) await start();
        if (!link.current.listening) await listen();
        abort.signal.throwIfAborted();
        await transport.current!.send(body, options);
        setNotice(`Acoustic delivery confirmed: ${description}`);
      } else {
        setPackets([]);
        setSession(undefined);
        setNotice(`Simulating PCM transmission for: ${description}`);
        await simulateTransfer(body, {
          monitor: monitorEvents,
          mode: operating,
          controller: setStats,
          sendOptions: options,
          content: item => {
            receive(item.text ?? item.name, 'SIMULATION / PCM / VERIFIED · SHA-256', item);
          },
          signal: abort.signal,
          waveform: (pcm, rate) => outgoing(pcm, rate, 'Simulation PCM'),
        });
        setNotice(`Simulation transfer complete: ${description}`);
      }
    } finally {
      if (sendAbort.current === abort) sendAbort.current = undefined;
    }
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
    const blob = new Blob([writeWav(wave.pcm, wave.sampleRate)], { type: 'audio/wav' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    URL.revokeObjectURL(a.href);
  }

  function cancelTransfer() {
    calibration.current?.cancel();
    transport.current?.cancel();
    sendAbort.current?.abort(new Error('Transfer cancelled.'));
  }

  const running = active(session?.phase);
  const physical = mode === 'microphone';
  const hint = /timed out|timeout/i.test(error) ? 'Check that the other device is listening. Enable both microphones, turn up the receiving device’s speaker for replies, and retry.' : '';

  function openConsole() {
    setActiveTab('transceiver');
    requestAnimationFrame(() => document.getElementById('workspace')?.scrollIntoView({block:'start'}));
  }
  return (
    <div className="console-root lunar" id="top">
      {/* Accessibility skip link */}
      <a className="skip" href="#workspace">Skip to transfer controls</a>

      <MoonRelay listening={listening} transferring={running || playing || replying} failed={!!error} packets={packets}/>
      <Navbar open={openConsole}/>
      <Hero open={openConsole} ready={ready} listening={listening} physical={physical}/>
      <Guide/>
      <section className="console-shell"><div className="lunar-wrap"><h2 className="console-title">Console</h2>
      <header className="console-header">
        {/* Selectable Operating Environments */}
        <div className="mode-switcher-bar" role="tablist" aria-label="Mission Environment">
          <button
            className={`mode-tab-btn transceiver ${activeTab === 'transceiver' ? 'active' : ''}`}
            onClick={() => setActiveTab('transceiver')}
          >
            📡 TRANSCEIVER
          </button>
          <button
            className={`mode-tab-btn rescue ${activeTab === 'rescue' ? 'active' : ''}`}
            onClick={() => setActiveTab('rescue')}
          >
            🚨 RESCUE
          </button>
          <button
            className={`mode-tab-btn airgap ${activeTab === 'airgap' ? 'active' : ''}`}
            onClick={() => setActiveTab('airgap')}
          >
            🔒 AIR-GAP
          </button>
          <button
            className={`mode-tab-btn trace ${activeTab === 'trace' ? 'active' : ''}`}
            onClick={() => setActiveTab('trace')}
          >
            📦 TRACE
          </button>
        </div>

        {/* Device Identity Badge and Audio Status */}
        <div className="header-controls">
          {localIdentity && (
            <button
              className="device-badge-btn"
              title="Click to view Identity & Trust"
              onClick={() => setActiveTab('trust')}
            >
              ID: <strong>{localIdentity.name}</strong> ({localIdentity.fingerprint.slice(0, 6)})
            </button>
          )}
          <span className={`pill ${ready ? 'green' : ''}`}>
            {listening ? '● Mic Open' : ready ? '● Audio Ready' : '○ Audio Off'}
          </span>
        </div>
      </header>

      {/* Genesis FX Markets Live Streaming Telemetry Ticker */}
      <AcousticTicker
        sampleRate={link.current.sampleRate}
        listening={listening}
        ready={ready}
        isSimulation={!physical}
        speedMode={physical ? speedMode : "fast"}
      />

      {/* Navigation Sub-Tabs */}
      <nav className="console-nav-bar" aria-label="Console Navigation">
        <button
          className={`nav-tab-item ${activeTab === 'transceiver' ? 'active' : ''}`}
          onClick={() => setActiveTab('transceiver')}
        >
          📡 Acoustic Transceiver
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'rescue' ? 'active' : ''}`}
          onClick={() => setActiveTab('rescue')}
        >
          🚨 Rescue Operations
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'airgap' ? 'active' : ''}`}
          onClick={() => setActiveTab('airgap')}
        >
          🔒 Air-Gap Security
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'trace' ? 'active' : ''}`}
          onClick={() => setActiveTab('trace')}
        >
          📦 Supply Chain Trace
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'visualizer' ? 'active' : ''}`}
          onClick={() => setActiveTab('visualizer')}
        >
          📊 Audio Spectrum & Readiness
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'trust' ? 'active' : ''}`}
          onClick={() => setActiveTab('trust')}
        >
          🔑 Identity & Trust
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'relay' ? 'active' : ''}`}
          onClick={() => setActiveTab('relay')}
        >
          🔄 Relay Mesh Queue
        </button>
        <button
          className={`nav-tab-item ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          📜 Cryptographic Audit Ledger
        </button>
      </nav>

      {/* Main Workspace Body */}
      <main style={{ flex: 1, paddingBottom: '32px' }}>
        {/* Scenario Views */}
        {activeTab === 'rescue' && (
          <RescueView
            bridge={defaultAcousticBridge}
            onSendPayload={sendScenarioPayload}
            currentDeviceId={localIdentity?.id || 'NODE-LOCAL'}
          />
        )}
        {activeTab === 'airgap' && (
          <AirGapView
            bridge={defaultAcousticBridge}
            onSendPayload={sendScenarioPayload}
            currentDeviceId={localIdentity?.id || 'NODE-LOCAL'}
          />
        )}
        {activeTab === 'trace' && (
          <TraceView
            bridge={defaultAcousticBridge}
            onSendPayload={sendScenarioPayload}
            currentDeviceId={localIdentity?.id || 'NODE-LOCAL'}
          />
        )}

        {/* Audio Visualizer Standalone View */}
        {activeTab === 'visualizer' && (
          <div className="scenario-view">
            <AudioVisualizerView
              audio={link.current}
              diagnostics={diagnostics}
              isSimulation={mode === 'simulation'}
            />
          </div>
        )}

        {/* Cryptographic Identity & Trust */}
        {activeTab === 'trust' && localIdentity && (
          <TrustView localIdentity={localIdentity} />
        )}

        {/* Multi-Hop Relay Mesh */}
        {activeTab === 'relay' && (
          <RelayQueueView
            bridge={defaultAcousticBridge}
            onSendPayload={sendScenarioPayload}
            currentDeviceId={localIdentity?.id || 'NODE-LOCAL'}
          />
        )}

        {/* Cryptographic Audit Ledger */}
        {activeTab === 'audit' && (
          <AuditView />
        )}

        {/* Classic Modem Link & 3D Instrument View */}
        {activeTab === 'transceiver' && (
          <div style={{ marginTop: '24px' }}>
            <div className="heading">
              <div>
                <h2>Connect through sound.</h2>
                <p>Open SONICBRIDGE on both devices and allow microphone access so they can exchange messages and acknowledgements.</p>
              </div>
              <div className="tabs" aria-label="Transport mode">
                <button aria-pressed={physical} disabled={!!busy || running} onClick={() => switchMode('microphone')}>
                  Physical Audio
                </button>
                <button aria-pressed={!physical} disabled={!!busy || running} onClick={() => switchMode('simulation')}>
                  Simulation · local PCM
                </button>
              </div>
            </div>

            <div className="console-grid" id="workspace" tabIndex={-1}>
              <div className="task-column">
                <section className="card setup">
                  <div className="card-heading">
                    <h2>{physical ? 'Audio setup' : 'Local simulation'}</h2>
                    <span className={'pill ' + (ready ? 'green' : '')}>{listening ? 'Mic open' : ready ? 'Audio ready' : 'Audio off'}</span>
                  </div>
                  <p>{physical ? 'On the sending laptop choose Send. On the other laptop choose Receive, then Listen with microphone.' : 'Run both endpoints here using generated PCM and a virtual clock. Your microphone and speaker are unused.'}</p>
                  <div className="actions">
                    <button className={ready ? undefined : 'primary'} disabled={!!busy || running} onClick={() => run('Starting audio…', start)}>
                      {ready ? 'Resume Audio' : 'Start Audio'}
                    </button>
                    {ready && (
                      <button onClick={() => { stopListening(); sendAbort.current?.abort(); link.current.stop(); setReady(false); setNotice('Audio stopped. Microphone released.'); }}>
                        Stop Audio
                      </button>
                    )}
                  </div>
                  {physical && (
                    <details className="route">
                      <summary>Check devices</summary>
                      <div className="device-controls">
                        <label>Microphone
                          <select aria-label="Microphone device" disabled={listening || !!busy} value={inputDevice} onChange={e => { setInputDevice(e.target.value); link.current.inputDeviceId = e.target.value; }}>
                            <option value="">Browser default microphone</option>
                            {devices.filter(d => d.kind === 'audioinput' && d.deviceId).map((d, i) => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
                            ))}
                          </select>
                        </label>
                        <label>Speaker
                          <select aria-label="Output device" disabled={listening || !!busy || !link.current.canSelectOutput} value={outputDevice} onChange={e => { const value = e.target.value; stopListening(); link.current.stop(); setReady(false); setOutputDevice(value); link.current.outputDeviceId = value; setNotice('Output choice saved. Tap Start Audio explicitly to apply it, then recalibrate.'); }}>
                            <option value="">Browser / OS default speaker</option>
                            {devices.filter(d => d.kind === 'audiooutput' && d.deviceId).map((d, i) => (
                              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${i + 1}`}</option>
                            ))}
                          </select>
                        </label>
                        <label>Playback gain {Math.round(volume * 100)}%
                          <input aria-label="Playback gain" disabled={!!busy} type="range" min="0.1" max="1" step="0.05" value={volume} onChange={e => { const value = Number(e.target.value); setVolume(value); link.current.setPlaybackGain(value); }} />
                        </label>
                        <button disabled={!!busy} onClick={() => run('Listing devices…', async () => { await link.current.refreshDevices(); })}>Refresh devices</button>
                      </div>
                      <p className="fine">Device labels may require microphone permission. Use the OS speaker picker when output selection is unavailable.</p>
                    </details>
                  )}
                </section>

                <section className="card composer" data-engaging={!!sendAbort.current && !error} aria-label="Transfer controls">
                  <div className="role-tabs" role="group" aria-label="Transfer direction">
                    <button disabled={!!busy || running} aria-pressed={role === 'send'} onClick={() => setRole('send')}>↗ Send</button>
                    <button disabled={!!busy || running} aria-pressed={role === 'receive'} onClick={() => setRole('receive')}>↙ Receive</button>
                  </div>
                  <div className="send-panel" id="send" hidden={role !== 'send'}>
                    {/* Acoustic Speed Mode Selector */}
                    <div className="speed-choice">
                      <strong>Acoustic transfer speed</strong>
                      <div className="speed-mode-bar" role="group" aria-label="Acoustic Speed Mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                        <button
                          type="button"
                          className={`btn-subtab ${speedMode === 'fastest' ? 'active' : ''}`}
                          aria-pressed={speedMode === 'fastest'}
                          disabled={!!busy || running}
                          onClick={() => {
                            setSpeedMode('fastest');
                            void link.current.setProtocol('fastest');
                            if (transport.current) transport.current.timing.guardMs = 250;
                            setNotice('Audible fastest selected');
                          }}
                        >
                          Audible fastest
                        </button>
                        <button
                          type="button"
                          className={`btn-subtab ${speedMode === 'fast' ? 'active' : ''}`}
                          aria-pressed={speedMode === 'fast'}
                          disabled={!!busy || running}
                          onClick={() => {
                            setSpeedMode('fast');
                            void link.current.setProtocol('fast');
                            if (transport.current) transport.current.timing.guardMs = operating === 'Robust' ? 900 : 500;
                            setNotice('Audible fast active · ~9.2s per chunk · ggwave AUDIBLE_FAST');
                          }}
                        >
                          Audible fast
                        </button>
                      </div>
                    </div>

                    <div className="kind-tabs" role="group" aria-label="Transfer type">
                      {(['text', 'image', 'file'] as const).map(k => (
                        <button key={k} disabled={!!busy || running} aria-pressed={k === kind} onClick={() => { resetDraft(); setError(''); setKind(k); }}>
                          {k === 'text' ? 'Text' : k === 'image' ? 'Image' : 'Small file'}
                        </button>
                      ))}
                    </div>
                    {kind === 'text' ? (
                      <>
                        <label htmlFor="message">What would you like to send?</label>
                        <textarea id="message" placeholder="Type a message…" disabled={!!busy} maxLength={MAX_TRANSFER_BYTES} value={text} onChange={e => { setText(e.target.value); }} spellCheck={false} />
                      </>
                    ) : (
                      <>
                        <label>{kind === 'image' ? 'Select PNG or JPEG' : 'Select a small file'}
                          <input key={kind} type="file" disabled={!!busy} accept={kind === 'image' ? 'image/png,image/jpeg' : undefined} onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void run('Reading local file…', () => choose(selected)); }} />
                        </label>
                        {draft && <p className="file-details">{name} · {count} encoded bytes</p>}
                        {kind === 'image' && image && original && (
                          <>
                            <RasterPreview bytes={image.bytes} mime={image.raster.mime} />
                            <p>{image.raster.width} × {image.raster.height} px · {image.thumbnail ? 'Thumbnail copy' : 'Original bytes'}</p>
                            <button disabled={!!busy || image.thumbnail} onClick={() => run('Making thumbnail…', async () => { setImage(await thumbnail(original)); })}>Make 1–3 KiB thumbnail</button>
                            {image.thumbnail && (
                              <>
                                <p>{count >= 1024 && count <= 3072 ? 'Within' : count < 1024 ? 'Below' : 'Above'} target of 1024–3072 bytes · actual {count} bytes</p>
                                <button disabled={!!busy} onClick={() => { setImage(original); }}>Use original</button>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}

                    <p className={count > capacity ? 'invalid' : 'fine'}>{count.toLocaleString()} / {capacity.toLocaleString()} content bytes{count > capacity && ' · exceeds transfer limit'}</p>
                    <div className="actions">
                      <button
                        className="send-button primary"
                        title={!ready ? 'Start Audio first' : !valid ? 'Choose content within the size limit' : replying ? 'Returning an acoustic reply' : undefined}
                        disabled={!ready || !valid || !!busy || running || replying}
                        onClick={() => { if (!sendAbort.current) void run(physical ? 'Acoustic transfer…' : 'PCM protocol simulation…', send); }}
                      >
                        {physical ? 'Start transmission' : 'Run PCM simulation'} ↗
                      </button>
                      {(sendAbort.current || running) && <button onClick={cancelTransfer}>Cancel transfer</button>}
                    </div>
                    {valid && <p className="fine">~{duration(seconds)} estimated · {estimate.count} DATA chunks · {measured ? 'scaled from previous transfer' : 'modeled without retries'}.</p>}
                  </div>

                  <div className="receive-panel" id="receive" hidden={role !== 'receive'}>
                    <div className="card-heading"><h2>Receive</h2><span className="mono">RX</span></div>
                    <h3><i className={'lamp ' + (physical && listening ? 'on' : '')} />{!physical ? 'Simulated receiver' : !listening ? 'Receiver offline' : replying ? 'Returning acoustic reply' : running ? 'Link in use' : 'Listening for a nearby sender'}</h3>
                    <p>{physical ? 'Keep this page open. The microphone listens for data and the speaker returns acknowledgements.' : 'The local receiver verifies the reconstructed payload before displaying it below.'}</p>
                    {mode === 'microphone' && (
                      <button
                        className={listening ? undefined : 'primary'}
                        disabled={!ready || !!busy || running}
                        onClick={() => {
                          if (listening) { stopListening(); return; }
                          void run('Requesting microphone…', async () => { await listen(); setNotice('Listening for v1 acoustic packets. Control replies use the same audible baseline.'); });
                        }}
                      >
                        {listening ? 'Stop listening' : 'Listen with microphone'}
                      </button>
                    )}
                    {running && <button onClick={cancelTransfer}>Cancel transfer</button>}
                    <p className="input-diagnostic">{physical && listening ? signalDescription(diagnostics.signal) : ''}</p>
                  </div>
                  {!ready && <p className="fine">Start Audio to enable transfer controls.</p>}
                </section>

                {busy && <p className="action-state">{busy}</p>}
                {error && <div className="error" role="alert"><strong>Link needs attention</strong><p>{error} {hint}</p></div>}
              </div>

              <SignalView
                key={mode}
                frame={frame}
                engagement={engagement}
                engaging={!!sendAbort.current && !error}
                live={playing || listening || !!sendAbort.current}
                receiving={role === 'receive'}
                verified={!busy && !error && (session?.phase === 'completed' || session?.phase === 'received')}
                caption={playing ? 'Speaker playback' : awaitingReply && running && !session?.receive ? 'Waiting for acknowledgement' : listening ? 'Microphone open' : physical ? 'Physical Audio' : 'Simulation PCM'}
              />
            </div>

            <div className="workspace">
              <SessionMonitor profile={physical && speedMode === "fastest" ? "Audible Fastest" : "Audible Fast"} session={session} events={packets} progress={progress} simulated={!physical} estimate={session?.receive ? undefined : initialEta} />
              <section className="card results">
                <div className="card-heading"><h2>Results</h2><span className="mono">{receipts.length} entries</span></div>
                <p className="fine">A checksum verifies integrity, not sender identity.</p><div className="inbox" aria-live="polite">
                  {receipts.length ? receipts.map(item => (
                    <article key={item.id} data-origin={item.source.startsWith('MICROPHONE / VERIFIED') ? 'verified' : item.source.includes('SIMULATION') ? 'sim' : 'fixture'}>
                      <div><span>{item.source}</span><time>{item.time}</time></div>
                      {item.file && item.file.kind !== 'text' ? (
                        <ReceivedFile item={item.file} preview={previewId === item.id} select={() => setPreviewId(previewId === item.id ? undefined : item.id)} />
                      ) : (
                        <HumanReadableReceipt
                          text={item.text}
                          onNavigateTab={tab => setActiveTab(tab)}
                        />
                      )}
                    </article>
                  )) : (
                    <div className="empty"><strong>No results yet</strong><p>{mode === 'microphone' ? 'Verified microphone transfers appear here.' : 'Run a simulation to decode generated audio.'}</p></div>
                  )}
                </div>
              </section>
            </div>

            {running && session && session.retries >= 2 && <p className="error">Repeated missing replies. Check that the peer is listening and that its speaker can reach this microphone.</p>}
            <div className="feedback" role="status">{busy ? busy + ' ' : ''}{notice}</div>

            <details className="tech">
              <summary>Technical details <span>Controller, calibration & diagnostics</span></summary>
              <div className="tech-body">
                <section className="controller-panel" aria-label="Link controller">
                  <label>Operating mode
                    <select value={operating} disabled={!!busy} onChange={e => {
                      const selected = e.target.value as OperatingMode;
                      setOperating(selected); setMeasurement(undefined); setStats(undefined);
                      if (mode === 'microphone') {
                        transport.current?.controller.select(selected);
                        if (transport.current) transport.current.timing.guardMs = speedMode === 'fastest' ? 250 : (selected === 'Robust' ? 900 : 500);
                      }
                    }}>
                      <option>Balanced</option><option>Robust</option><option>Adaptive</option>
                    </select>
                  </label>
                  <p>{operating === 'Balanced' ? '500 ms DATA and ACK guards. Up to four DATA attempts.' :
                    operating === 'Robust' ? '900 ms DATA and ACK guards. Up to six DATA attempts after acoustic agreement.' :
                      'Starts Balanced. Repeated ACK loss requests Robust. Eight clean first-attempt ACKs and a 30 s dwell allow recovery.'}</p>
                  {stats && (
                    <>
                      <p>{mode === 'microphone' ? 'Microphone' : 'Simulated PCM'} · sender target {stats.target} · {physical && speedMode === "fastest" ? "Audible Fastest" : "Audible Fast"}</p>
                      <p>Last {stats.attempts} resolved DATA attempts · ACKs {stats.acks} · timeouts {stats.attempts - stats.acks} · retries {stats.retries}
                        {stats.attempts > 0 && ` (ACK ${Math.round(100 * stats.acks / stats.attempts)}%, timeout ${Math.round(100 * (1 - stats.acks / stats.attempts))}%, retry ${Math.round(100 * stats.retries / stats.attempts)}%)`}</p>
                      <p>Recent local modem outputs · valid packets {stats.decoded} · rejected packets {stats.rejected}
                        {stats.confirmedBps !== undefined && ` · confirmed content goodput ${stats.confirmedBps.toFixed(2)} B/s`}</p>
                      {stats.history.length > 0 && <details><summary>Controller decisions</summary><ul>{stats.history.map((entry, i) => <li key={i}>{entry}</li>)}</ul></details>}
                    </>
                  )}
                </section>

                <h2>Device diagnostics</h2>
                <dl className="diagnostic-grid">
                  <div><dt>Audio context</dt><dd>{diagnostics.contextState} · {diagnostics.contextRate ?? '—'} Hz</dd></div>
                  <div><dt>Microphone / capture graph</dt><dd>{diagnostics.trackRate ?? 'not reported'} / {diagnostics.signal?.sampleRate ?? diagnostics.contextRate ?? '—'} Hz</dd></div>
                  <div><dt>Permission</dt><dd>{diagnostics.permission}</dd></div>
                  <div><dt>Effective input</dt><dd>{diagnostics.inputLabel ?? 'not opened'}</dd></div>
                </dl>
                <p className="input-diagnostic">{!listening && diagnostics.signal ? 'Last capture: ' : ''}{signalDescription(diagnostics.signal)}</p>
                <p className="fine">{diagnostics.deviceNote} Track audio is converted by Web Audio to the graph rate; the modem handles conversion to its internal 48 kHz. Clipping is latched until input restarts.</p>
                <ul className="processing-report">{diagnostics.processing.map(line => <li key={line}>{line}</li>)}</ul>

                {mode === 'microphone' && (
                  <div className="calibration">
                    <h2>Calibrate between two devices</h2>
                    <p>On the other device, Start Audio and arm its receiver. On this device, Start Audio and calibrate. Both sides exchange a fresh challenge through sound; a local tone alone is not calibration.</p>
                    <div className="actions">
                      <button disabled={!ready || !!busy} aria-pressed={armed} onClick={() => run('Arming calibration…', async () => { if (!link.current.listening) await listen(); calibration.current!.arm(); })}>
                        {armed ? 'Calibration receiver armed' : 'Arm calibration receiver'}
                      </button>
                      <button disabled={!ready || !!busy} onClick={() => run('Calibrating acoustic link…', async () => { if (!link.current.listening) await listen(); await calibration.current!.run(); })}>
                        Calibrate link
                      </button>
                    </div>
                    <p className="calibration-status" aria-live="polite">{calibrationStatus}</p>
                    <p className="fine">Peer flags: 1 near silence, 2 clipping during capture, 4 no measurements, 8 audio processing not confirmed off. A verified challenge establishes this exchange, not a range, SNR, or future-delivery guarantee.</p>
                  </div>
                )}

                <section className="fixtures">
                  <h2>Diagnostic audio</h2>
                  <p>Export the latest outgoing packet or inspect a local WAV. Record a five-second microphone clip only when needed. Export saves a WAV. Discard or stop listening to clear the clip from memory.</p>
                  <div className="actions">
                    <button disabled={!fixture || !!busy} onClick={() => exportFixture()}>Export WAV</button>
                    <label>Import WAV
                      <input type="file" accept=".wav,audio/wav" disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run('Decoding WAV…', () => importFixture(f)); }} />
                    </label>
                  </div>
                  {physical && (
                    <div className="actions">
                      <button disabled={!listening || recordState === 'recording'} onClick={() => { const rate = link.current.sampleRate; if (rate) { recording.current = { pcm: new Float32Array(rate * 5), rate, used: 0 }; setRecordState('recording'); } }}>
                        Record 5 s of microphone
                      </button>
                      {recordState !== 'off' && (
                        <>
                          <span>{recordState === 'recording' ? 'Recording microphone…' : '5 s captured'}</span>
                          <button onClick={discardCapture}>Discard recording</button>
                        </>
                      )}
                      {recordState === 'captured' && (
                        <button onClick={() => { const rec = recording.current; if (rec) exportFixture({ pcm: rec.pcm, sampleRate: rec.rate }, 'sonicbridge-microphone.wav'); }}>
                          Export microphone WAV
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </details>

            <section className="offline-panel">
              <h2>Offline installation</h2>
              <p>{offline.message}</p>
              {offline.update && <button onClick={offline.update}>Stop audio & update app</button>}
              <p>Load once on trusted HTTPS or localhost. Wait for offline readiness before disconnecting.</p>
            </section>
          </div>
        )}
      </main>

      </div></section><Footer/>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
