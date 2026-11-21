import { MAX_BYTES } from './modem';
import { aborted } from './clock';
import type { PacketChannel } from './transport';
import { WorkerModem } from './worker-modem';
import { captureConstraints, processingReport, type AudioDiagnostics, type SignalStats } from './audio-diagnostics';

export const DEFAULT_PLAYBACK_GAIN = 0.6; // ggwave's existing 25% level × 0.6 = about 15% full scale.
export function describeError(error: unknown): string {
  const e = error instanceof Error ? error : new Error(String(error));
  const hints: Record<string, string> = {
    NotAllowedError: 'Microphone permission was denied. Allow microphone access in browser site settings, then try again.',
    NotFoundError: 'No microphone found. Connect an input device and try again.',
    NotReadableError: 'Microphone is unavailable or in use. Check OS privacy settings and other audio apps.',
    OverconstrainedError: 'This microphone does not support the requested audio settings.',
    SecurityError: 'Microphone access is blocked. Open the app over HTTPS or localhost.',
  };
  return hints[e.name] ? `${hints[e.name]} (${e.name}: ${e.message})` : `${e.name}: ${e.message}`;
}
type RoutableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
export class AudioLink implements PacketChannel {
  private context?: RoutableContext;
  private modem?: WorkerModem;
  private gain?: GainNode;
  private stream?: MediaStream;
  private input?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private analyser?: AnalyserNode;
  private speaker?: AudioBufferSourceNode;
  private finishPlayback?: (error?: unknown) => void;
  private transmitting = false;
  private starting = false;
  private opening = false;
  private workletLoaded = false;
  private ignoreBefore = 0;
  private epoch = 0;
  private captureEpoch = 0;
  private lastCapture = 0;
  private watchdog?: ReturnType<typeof setInterval>;
  private permission?: PermissionStatus;
  private receivers = new Set<(bytes: Uint8Array) => void>();
  private playbackGain = DEFAULT_PLAYBACK_GAIN;
  inputDeviceId = '';
  outputDeviceId = '';
  readonly maxPacketBytes = MAX_BYTES;
  diagnostics: AudioDiagnostics = { contextState: 'closed', permission: 'not requested', processing: [], deviceNote: 'Device names may be hidden until microphone permission is granted.' };
  onDiagnostics?: (diagnostics: AudioDiagnostics) => void;
  onInterrupted?: (reason: string) => void;
  onDevices?: (devices: MediaDeviceInfo[]) => void;
  onRangeCapture?: (pcm: Float32Array, startTime: number) => void;
  onCapture?: (pcm: Float32Array, rate: number) => void;
  onWaveform?: (pcm: Float32Array, sampleRate: number) => void;
  onPlaybackEnd?: () => void;
  private playbackStarted = 0;
  get playbackSeconds() { return this.speaker && this.context ? this.context.currentTime - this.playbackStarted : undefined; }
  get sampleRate() { return this.context?.sampleRate; }
  get listening() { return !!this.stream; }
  get canSelectOutput() { return typeof window.AudioContext === 'function' && typeof (AudioContext.prototype as RoutableContext).setSinkId === 'function'; }
  getAnalyser() { return this.analyser; }
  subscribe(receive: (bytes: Uint8Array) => void) { this.receivers.add(receive); return () => { this.receivers.delete(receive); }; }
  private report(update: Partial<AudioDiagnostics>) { this.diagnostics = { ...this.diagnostics, ...update }; this.onDiagnostics?.(this.diagnostics); }
  setPlaybackGain(value: number) {
    if (!Number.isFinite(value) || value < 0.1 || value > 1) throw new Error('Playback gain must be between 10% and 100%.');
    this.playbackGain = value;
    if (this.gain && this.context) this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.02);
  }
  async setProtocol(protocol: 'fast' | 'fastest') {
    await this.modem?.setProtocol(protocol);
  }
  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) { this.report({ deviceNote: 'This browser does not expose device enumeration. Use OS audio settings.' }); return []; }
    const devices = await navigator.mediaDevices.enumerateDevices(); this.onDevices?.(devices); return devices;
  }
  private background = () => { if (document.hidden) this.interrupt('Page backgrounded or screen locked. Transfer stopped; return here and tap Start Audio, then listen again.'); };
  private pageHidden = () => this.interrupt('Page hidden/frozen. Transfer stopped; tap Start Audio when you return.');
  private deviceChanged = () => {
    if (!this.opening) this.interrupt('Audio devices or route changed. Re-select devices, tap Start Audio, and recalibrate.');
    void this.refreshDevices().catch(error => this.report({ deviceNote: describeError(error) }));
  };
  private sinkChanged = () => { if (!this.starting) this.interrupt('Output route changed. Transfer stopped; tap Start Audio and recalibrate.'); };
  private interrupt(reason: string) {
    if (!this.context) return;
    this.stop(); this.onInterrupted?.(reason);
  }
  private running() {
    if (!this.context || !this.modem || this.context.state !== 'running') throw new Error('Audio is not running. Tap Start Audio / Resume Audio explicitly, then listen again.');
    return this.context;
  }
  /** Only called directly from a visible Start/Resume click, never from protocol timers. */
  async start() {
    if (!window.isSecureContext) throw new Error('Audio capture requires trusted HTTPS or localhost. An ordinary HTTP phone LAN URL cannot use the microphone.');
    if (!window.AudioContext) throw new Error('Web Audio is unavailable in this browser.');
    if (navigator.userActivation && !navigator.userActivation.isActive) throw new Error('Tap Start Audio to activate sound. Automatic resume is disabled.');
    if (this.starting) throw new Error('Audio is already starting.');
    this.starting = true;
    const epoch = this.epoch;
    const context: RoutableContext = this.context ??= new AudioContext({ latencyHint: 'interactive' });
    document.addEventListener('visibilitychange', this.background);
    window.addEventListener('pagehide', this.pageHidden);
    document.addEventListener('freeze', this.pageHidden);
    navigator.mediaDevices?.addEventListener('devicechange', this.deviceChanged);
    context.addEventListener('sinkchange', this.sinkChanged);
    context.onstatechange = () => {
      if (this.context !== context) return;
      this.report({ contextState: context.state });
      if (!this.starting && context.state !== 'running') this.interrupt(`Audio context ${context.state} (OS interruption, route, or lock). Tap Start Audio to restart; transfers were cancelled.`);
    };
    try {
      await context.resume(); // Invoked synchronously before the click's first await.
      if (context.state !== 'running') throw new Error('Audio activation did not succeed. Tap Start Audio again.');
      if (this.outputDeviceId) {
        if (context.setSinkId) await context.setSinkId(this.outputDeviceId);
        else this.report({ deviceNote: 'Output selection unsupported; browser/OS chooses the speaker. Use OS route controls.' });
      }
      if (!this.modem) { this.modem = new WorkerModem(error => this.interrupt(`Modem DSP worker stopped: ${describeError(error)}. Tap Start Audio.`)); await this.modem.init(context.sampleRate); }
      if (epoch !== this.epoch || this.context !== context) throw new Error('Audio startup was cancelled.');
      if (context.state !== 'running') throw new Error('Audio was interrupted during startup. Tap Start Audio again.');
      this.gain ??= context.createGain(); this.gain.gain.value = this.playbackGain; this.gain.connect(context.destination);
      this.report({ contextState: context.state, contextRate: context.sampleRate });
      void this.refreshDevices().catch(error => this.report({ deviceNote: describeError(error) }));
      if (navigator.permissions) {
        void navigator.permissions.query({ name: 'microphone' as PermissionName }).then(permission => {
          if (this.context !== context) return;
          if (this.permission) this.permission.onchange = null;
          this.permission = permission;
          const update = () => { this.report({ permission: permission.state }); if (permission.state === 'denied' && this.stream) this.interrupt('Microphone permission revoked. Allow it in site settings, then Start Audio.'); };
          permission.onchange = update; update();
        }).catch(() => { if (this.context === context) this.report({ permission: 'Permission status not exposed; the microphone request will ask.' }); });
      }
    } catch (error) { if (this.context === context) this.stop(); throw error; }
    finally { this.starting = false; }
  }
  async send(bytes: Uint8Array, signal: AbortSignal, showWaveform = true) {
    const context = this.running(), modem = this.modem!;
    if (!this.listening) throw new Error('Listen with microphone before sending; acoustic ACKs require reception.');
    if (this.transmitting) throw new Error('Speaker is already transmitting.');
    if (signal.aborted) throw aborted(signal);
    this.transmitting = true; this.ignoreBefore = Infinity;
    try {
      await modem.reset();
      const pcm = await modem.encode(bytes);
      if (signal.aborted) throw aborted(signal);
      if (this.context !== context) throw new Error('Audio route stopped during encoding.');
      this.running();
      await this.play(pcm, signal, context, showWaveform);
    } finally {
      if (this.modem === modem) {
        await modem.reset();
        this.ignoreBefore = context.currentTime + 0.25; this.transmitting = false;
      }
    }
  }
  async playRangeProbe(pcm: Float32Array, signal: AbortSignal) {
    const context = this.running();
    if (!this.listening || this.transmitting) throw new Error('Acoustic ranging audio is busy.');
    signal.throwIfAborted();
    this.transmitting = true;
    this.ignoreBefore = Infinity;
    try {
      await this.play(pcm, signal, context, false);
    } finally {
      if (this.context === context) {
        this.transmitting = false;
        this.ignoreBefore = context.currentTime + .25;
      }
    }
  }
  private play(pcm: Float32Array, signal: AbortSignal, context: AudioContext, showWaveform: boolean) {
    const buffer = context.createBuffer(1, pcm.length, context.sampleRate);
    buffer.copyToChannel(Float32Array.from(pcm), 0);
    const speaker = this.speaker = context.createBufferSource(); speaker.buffer = buffer; speaker.connect(this.gain!);
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown) => {
        if (finished) return; finished = true;
        speaker.onended = null; signal.removeEventListener('abort', cancel); speaker.disconnect();
        if (this.speaker === speaker) { this.speaker = undefined; this.finishPlayback = undefined; if (showWaveform) this.onPlaybackEnd?.(); }
        if (error) reject(error); else resolve();
      };
      const cancel = () => { speaker.stop(); finish(aborted(signal)); };
      this.finishPlayback = finish; speaker.onended = () => finish();
      if (signal.aborted) { finish(aborted(signal)); return; }
      signal.addEventListener('abort', cancel, { once: true });
      try { speaker.start(); this.playbackStarted = context.currentTime; if (showWaveform) this.onWaveform?.(pcm, context.sampleRate); } catch (error) { finish(error); }
    });
  }
  async listen(level: (rms: number) => void, failure: (error: unknown) => void) {
    const context = this.running(), modem = this.modem!;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone API unavailable. Use trusted HTTPS or localhost.');
    if (this.stream) return;
    if (this.opening) throw new Error('Microphone permission request already pending.');
    const epoch = ++this.captureEpoch; this.opening = true;
    let stream: MediaStream | undefined, stage = 'Requesting microphone';
    try {
      const supported = navigator.mediaDevices.getSupportedConstraints();
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: captureConstraints(supported, this.inputDeviceId), video: false }); }
      catch (error) {
        if (this.inputDeviceId && error instanceof DOMException && ['OverconstrainedError', 'NotFoundError'].includes(error.name)) {
          this.report({ deviceNote: 'Selected microphone unavailable; trying the default microphone. Inspect the effective device below.' });
          stream = await navigator.mediaDevices.getUserMedia({ audio: captureConstraints(supported), video: false });
        } else throw error;
      }
      if (this.context !== context || epoch !== this.captureEpoch) throw new Error('Microphone startup cancelled.');
      this.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('Microphone stream has no audio track.');
      const settings = track.getSettings();
      const selection = this.inputDeviceId && settings.deviceId !== this.inputDeviceId ? 'Requested microphone not confirmed; browser/OS chose a device.' : 'Effective input shown below. Output selection depends on browser/OS support.';
      this.report({ permission: 'granted (live microphone)', trackRate: settings.sampleRate, inputLabel: track.label || 'Browser default microphone', processing: processingReport(supported, settings), deviceNote: selection, signal: undefined });
      stage = 'Loading microphone AudioWorklet';
      if (!context.audioWorklet) throw new Error('AudioWorklet unavailable. Use a current browser over trusted HTTPS.');
      if (!this.workletLoaded) {
        await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
        if (this.context !== context || epoch !== this.captureEpoch) throw new Error('Microphone startup cancelled.');
        this.workletLoaded = true;
      }
      await modem.reset();
      if (this.context !== context || epoch !== this.captureEpoch) throw new Error('Microphone startup cancelled.');
      stage = 'Connecting microphone capture';
      this.input = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 256;
      this.input.connect(this.analyser);
      const capture = this.capture = new AudioWorkletNode(context, 'pcm-capture');
      this.ignoreBefore = context.currentTime;
      this.lastCapture = performance.now();
      capture.port.onmessage = ({ data }: MessageEvent<{ pcm?: Float32Array; startTime?: number; stats?: SignalStats }>) => {
        if (this.capture !== capture) return;
        if (data.stats) {
          level(data.stats.rms); this.report({ signal: data.stats });
          if (data.stats.droppedSamples) this.interrupt('Capture buffer overflow: device could not keep up. Audio stopped; close busy apps, Start Audio and recalibrate.');
          return;
        }
        const pcm = data.pcm;
        if (!pcm) return;
        this.lastCapture = performance.now();
        this.onCapture?.(pcm, context.sampleRate);
        if (data.startTime !== undefined) this.onRangeCapture?.(pcm, data.startTime);
        const recycle = (buffer: Float32Array) => { if (this.capture === capture) capture.port.postMessage({ recycle: buffer }, [buffer.buffer as ArrayBuffer]); };
        if (this.transmitting || (data.startTime ?? -1) <= this.ignoreBefore) { recycle(pcm); return; }
        void modem.decode(pcm).then(result => {
          recycle(result.pcm);
          if (this.capture === capture && !this.transmitting) result.packets.forEach(bytes => this.receivers.forEach(receive => receive(bytes)));
        }).catch(error => { if (this.capture === capture) { this.interrupt(`Modem DSP failed: ${describeError(error)}. Tap Start Audio.`); failure(error); } });
      };
      capture.onprocessorerror = () => this.interrupt('Microphone worklet failed. Start Audio again.');
      track.onended = () => this.interrupt('Microphone disconnected or permission revoked. Start Audio and re-select the input.');
      track.onmute = () => this.interrupt('Operating system interrupted/muted the microphone. Return to the app and tap Start Audio.');
      this.input.connect(capture); capture.connect(context.destination); // Silent output keeps processing alive.
      this.watchdog = setInterval(() => { if (performance.now() - this.lastCapture > 3000) this.interrupt('Microphone capture stalled (possible screen lock or OS interruption). Tap Start Audio and listen again.'); }, 1000);
      await this.refreshDevices();
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (this.context === context && epoch === this.captureEpoch) { this.stopListening(); this.report({ permission: describeError(error) }); }
      throw new Error(`${stage}: ${describeError(error)}`);
    } finally { this.opening = false; }
  }
  stopListening() {
    const wasListening = !!this.stream;
    this.captureEpoch++; if (this.watchdog) clearInterval(this.watchdog); this.watchdog = undefined;
    this.capture?.port.close(); this.capture?.disconnect(); this.input?.disconnect();
    this.analyser?.disconnect(); this.analyser = undefined;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.stop(); });
    this.capture = undefined; this.input = undefined; this.stream = undefined;
    if (wasListening) this.report({ permission: `${this.permission?.state ?? 'granted'} (input stopped)` });
  }
  stop() {
    this.epoch++; this.stopListening();
    this.speaker?.stop(); this.finishPlayback?.(new Error('Audio playback stopped.'));
    this.transmitting = false; this.ignoreBefore = Infinity;
    this.modem?.dispose(); this.modem = undefined; this.gain?.disconnect(); this.gain = undefined;
    const context = this.context; this.context = undefined; this.workletLoaded = false;
    if (context) { context.onstatechange = null; context.removeEventListener('sinkchange', this.sinkChanged); if (context.state !== 'closed') void context.close().catch(() => {}); }
    if (this.permission) this.permission.onchange = null; this.permission = undefined;
    document.removeEventListener('visibilitychange', this.background); document.removeEventListener('freeze', this.pageHidden);
    window.removeEventListener('pagehide', this.pageHidden); navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChanged);
    this.report({ contextState: 'closed' });
  }
}
