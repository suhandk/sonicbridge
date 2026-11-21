import { createModem, type Modem, type ModemFactory } from './modem';
const scope = self as unknown as { onmessage: (event: MessageEvent) => void; postMessage(message: unknown, transfer?: Transferable[]): void };
let modem: Modem | undefined;
scope.onmessage = async ({ data }) => {
  const { id, kind } = data;
  try {
    if (kind === 'init') {
      const runtime = await import(/* @vite-ignore */ data.runtimeUrl) as { default: ModemFactory };
      modem = await createModem(data.sampleRate, runtime.default);
      scope.postMessage({ id, ok: true }); return;
    }
    if (!modem) throw new Error('DSP worker is not initialized.');
    if (kind === 'encode') {
      const pcm = modem.encodeBytes(data.bytes, data.profile);
      scope.postMessage({ id, pcm }, [pcm.buffer as ArrayBuffer]);
    } else if (kind === 'decode') {
      const packets = modem.decodeBytes(data.pcm);
      scope.postMessage({ id, packets, pcm: data.pcm }, [data.pcm.buffer, ...packets.map(p => p.buffer as ArrayBuffer)]);
    } else if (kind === 'reset') { modem.reset(); scope.postMessage({ id, ok: true }); }
    else throw new Error('Unknown DSP operation.');
  } catch (error) { scope.postMessage({ id, error: String(error) }); }
};
