// Only this adapter knows the Emscripten / ggwave API.
type EnumValue = object;
interface Parameters {
  sampleRateInp: number; sampleRateOut: number;
  sampleFormatInp: EnumValue; sampleFormatOut: EnumValue;
  [key: string]: unknown;
}
export interface GgModule {
  getDefaultParameters(): Parameters;
  SampleFormat: { GGWAVE_SAMPLE_FORMAT_F32: EnumValue };
  ProtocolId: { GGWAVE_PROTOCOL_AUDIBLE_FAST: EnumValue; GGWAVE_PROTOCOL_AUDIBLE_FASTEST: EnumValue; [key: string]: unknown };
  init(parameters: Parameters): number;
  free(instance: number): void;
  encode(instance: number, text: string | Uint8Array, protocol: EnumValue, volume: number): Int8Array;
  decode(instance: number, bytes: Uint8Array): Int8Array;
  disableLog(): void;
}
export type ModemFactory = (options?: { print?: (line: string) => void }) => Promise<GgModule>;
declare global { interface Window { ggwave_factory?: ModemFactory } }
export type ModemProtocol = 'fast' | 'fastest';

export interface Modem {
  readonly sampleRate: number;
  readonly maxMessageBytes: number;
  protocol: ModemProtocol;
  encode(text: string): Float32Array;
  decode(pcm: Float32Array): string[];
  encodeBytes(bytes: Uint8Array): Float32Array;
  decodeBytes(pcm: Float32Array): Uint8Array[];
  reset(): void;
  dispose(): void;
}
export const MAX_BYTES = 140;
export const byteLength = (text: string) => new TextEncoder().encode(text).length;
const runtimes = new WeakMap<ModemFactory, Promise<GgModule>>();
export async function createModem(sampleRate: number, factory = window.ggwave_factory): Promise<Modem> {
  if (!factory) throw new Error('Local ggwave runtime did not load. Reload the page and check vendor/ggwave.js.');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Unsupported PCM sample rate.');
  let runtime = runtimes.get(factory);
  if (!runtime) {
    runtime = factory({ print: () => {} }); runtimes.set(factory, runtime);
    void runtime.catch(() => runtimes.delete(factory));
  }
  const g = await runtime;
  g.disableLog();
  const parameters = g.getDefaultParameters();
  parameters.sampleRateInp = sampleRate;
  parameters.sampleRateOut = sampleRate;
  parameters.sampleFormatInp = g.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  parameters.sampleFormatOut = g.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  let instance = g.init(parameters);
  if (instance < 0) throw new Error('ggwave could not allocate a modem instance.');
  let disposed = false;
  // ggwave 0.4.0's resampler loses detection with tiny input calls at 44.1 kHz.
  // Accumulate arbitrary AudioWorklet chunks into tested 4096-sample batches.
  const pending = new Float32Array(4096);
  let pendingLength = 0;
  const check = () => { if (disposed) throw new Error('Modem has been closed.'); };
  let protocol: ModemProtocol = 'fast';
  const modem: Modem = {
    sampleRate, maxMessageBytes: MAX_BYTES,
    get protocol() { return protocol; },
    set protocol(p: ModemProtocol) { protocol = p; },
    encode(text) {
      return modem.encodeBytes(new TextEncoder().encode(text));
    },
    encodeBytes(data) {
      check();
      if (!data.length || data.length > MAX_BYTES) throw new Error(`Message must contain 1–${MAX_BYTES} bytes (UTF-8 for text).`);
      // Embind std::string accepts Uint8Array, preserving NUL and bytes >= 0x80.
      const protoId = protocol === 'fastest' && g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST
        ? g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST
        : g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST;
      const raw = g.encode(instance, data, protoId, 25);
      if (!raw.length || raw.byteLength % 4) throw new Error('Modem returned an invalid waveform.');
      // Emscripten returns borrowed memory, invalidated by the next call: copy immediately.
      const bytes = Uint8Array.from(raw);
      return new Float32Array(bytes.buffer);
    },
    decode(pcm) {
      return modem.decodeBytes(pcm).map(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    },
    decodeBytes(pcm) {
      check();
      const messages: Uint8Array[] = [];
      for (let at = 0; at < pcm.length;) {
        const size = Math.min(pending.length - pendingLength, pcm.length - at);
        pending.set(pcm.subarray(at, at + size), pendingLength); pendingLength += size; at += size;
        if (pendingLength === pending.length) {
          const raw = g.decode(instance, new Uint8Array(pending.buffer));
          if (raw.length) messages.push(Uint8Array.from(raw));
          pendingLength = 0;
        }
      }
      return messages;
    },
    reset() {
      check(); g.free(instance); instance = g.init(parameters); pendingLength = 0;
      if (instance < 0) { disposed = true; throw new Error('Could not reset modem receive state.'); }
    },
    dispose() { if (!disposed) { g.free(instance); disposed = true; } },
  };
  return modem;
}
export function decodeFixture(modem: Modem, pcm: Float32Array): string[] {
  return decodeBinaryFixture(modem, pcm).map(bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export function decodeBinaryFixture(modem: Modem, pcm: Float32Array): Uint8Array[] {
  const messages: Uint8Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += 1024) messages.push(...modem.decodeBytes(pcm.subarray(offset, offset + 1024)));
  // Flush final detection windows, as live capture would with ambient silence.
  for (let i = 0; i < 24; i++) messages.push(...modem.decodeBytes(new Float32Array(1024)));
  return messages;
}
