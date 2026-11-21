import { useEffect, useRef, useState } from 'react';
import { describeError } from './audio';
import { captureConstraints } from './audio-diagnostics';

const captureSeconds = 5;
const modelRate = 16000;

async function recordSpeech(inputDevice: string, signal: AbortSignal, onRecording: () => void) {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error('Microphone access requires trusted HTTPS or localhost.');
  const context = new AudioContext();
  let stream: MediaStream | undefined;
  let capture: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  try {
    await context.resume();
    signal.throwIfAborted();
    stream = await media.getUserMedia({ audio: captureConstraints(media.getSupportedConstraints(), inputDevice), video: false });
    signal.throwIfAborted();
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}capture-worklet.js`);
    signal.throwIfAborted();
    capture = new AudioWorkletNode(context, 'pcm-capture');
    source = context.createMediaStreamSource(stream);
    const node = capture;
    const input = source;
    const pcm = new Float32Array(context.sampleRate * captureSeconds);
    let used = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stop: (() => void) | undefined;
    await new Promise<void>((resolve, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      timeout = setTimeout(() => reject(new Error('No microphone audio arrived. Check the input device and try again.')), 10000);
      node.onprocessorerror = () => reject(new Error('Microphone capture failed. Try recording again.'));
      node.port.onmessage = ({ data }: MessageEvent<{ pcm?: Float32Array }>) => {
        if (!data.pcm) return;
        const length = Math.min(data.pcm.length, pcm.length - used);
        pcm.set(data.pcm.subarray(0, length), used);
        used += length;
        node.port.postMessage({ recycle: data.pcm }, [data.pcm.buffer as ArrayBuffer]);
        if (used === pcm.length) resolve();
      };
      input.connect(node);
      node.connect(context.destination);
      onRecording();
    }).finally(() => {
      clearTimeout(timeout);
      if (stop) signal.removeEventListener('abort', stop);
    });
    return { pcm, rate: context.sampleRate };
  } finally {
    stream?.getTracks().forEach(track => track.stop());
    capture?.port.close();
    capture?.disconnect();
    source?.disconnect();
    await context.close();
  }
}

async function toModelRate(pcm: Float32Array<ArrayBuffer>, rate: number) {
  if (rate === modelRate) return pcm;
  const context = new OfflineAudioContext(1, captureSeconds * modelRate, modelRate);
  const audio = context.createBuffer(1, pcm.length, rate);
  audio.copyToChannel(pcm, 0);
  const source = context.createBufferSource();
  source.buffer = audio;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0);
}

async function transcribe(pcm: Float32Array, signal: AbortSignal) {
  const worker = new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      stop = () => reject(signal.reason);
      signal.addEventListener('abort', stop, { once: true });
      timeout = setTimeout(() => reject(new Error('Local transcription timed out. Try again.')), 120000);
      worker.onmessage = ({ data }: MessageEvent<{ text?: string; error?: string }>) => {
        if (data.error) reject(new Error(data.error));
        else if (data.text !== undefined) resolve(data.text);
      };
      worker.onerror = () => reject(new Error('The local speech engine could not start.'));
      worker.postMessage({ id: 1, pcm }, [pcm.buffer as ArrayBuffer]);
    });
  } finally {
    clearTimeout(timeout);
    if (stop) signal.removeEventListener('abort', stop);
    worker.terminate();
  }
}

interface SpeechDictationProps {
  ready: boolean;
  disabled: boolean;
  inputDevice: string;
  onActive: (active: boolean) => void;
  onTranscript: (transcript: string) => void;
}

export function SpeechDictation({ ready, disabled, inputDevice, onActive, onTranscript }: SpeechDictationProps) {
  const operation = useRef<AbortController>(null);
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) operation.current?.abort(new Error('Dictation stopped when this tab was hidden.'));
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      const current = operation.current;
      operation.current = null;
      current?.abort();
      if (current) onActive(false);
    };
  }, [onActive]);

  useEffect(() => {
    if (!ready || disabled) operation.current?.abort(new Error('Dictation stopped because audio is unavailable or a transfer is active.'));
  }, [ready, disabled]);

  async function dictate() {
    if (operation.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    operation.current = controller;
    onActive(true);
    setRecording(true);
    setStatus('Opening microphone…');
    try {
      const { pcm, rate } = await recordSpeech(inputDevice, signal, () => setStatus('Recording for 5 seconds…'));
      signal.throwIfAborted();
      if (pcm.every(sample => Math.abs(sample) < .001)) throw new Error('No speech detected. Check that your microphone is unmuted and try again.');
      setStatus('Transcribing on this device…');
      const samples = await toModelRate(pcm, rate);
      signal.throwIfAborted();
      const text = await transcribe(samples, signal);
      signal.throwIfAborted();
      if (!text) throw new Error('No speech recognized. Try speaking closer to the microphone.');
      onTranscript(text);
      setStatus('Transcript added. Review it before sending.');
    } catch (error) {
      if (operation.current === controller) {
        const detail = error instanceof Error && error.name === 'Error' ? error.message : describeError(error);
        setStatus(/\/models\/|fetch/i.test(detail)
          ? 'Speech assets are unavailable. Use dictation once while online before using it offline.'
          : detail);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        onActive(false);
        setRecording(false);
      }
    }
  }

  return <div className="speech-dictation">
    <div className="actions">
      <button type="button" disabled={!ready || disabled || recording} onClick={() => void dictate()}>Speak to fill message</button>
      {recording && <button type="button" onClick={() => operation.current?.abort(new Error('Dictation cancelled.'))}>Cancel dictation</button>}
    </div>
    <p className="fine" role="status" aria-label="Dictation status">{status || (ready ? 'Moonshine Tiny · English · 5 seconds. First use loads the local model.' : 'Start Audio to enable English dictation.')}</p>
  </div>;
}
