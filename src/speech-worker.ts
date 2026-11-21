import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = `${import.meta.env.BASE_URL}models/`;
env.useBrowserCache = false;
env.useWasmCache = false;
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.numThreads = 1;
  const runtime = new URL(`${import.meta.env.BASE_URL}speech-runtime/`, self.location.href);
  wasm.wasmPaths = {
    mjs: new URL('ort-wasm-simd-threaded.mjs', runtime).href,
    wasm: new URL('ort-wasm-simd-threaded.wasm', runtime).href,
  };
}
const modelId = 'onnx-community/moonshine-tiny-ONNX';

type WorkerMessage = { id: number; pcm: Float32Array };
const scope = self as unknown as { onmessage: (event: MessageEvent<WorkerMessage>) => void; postMessage(message: unknown): void };
scope.onmessage = async ({ data }) => {
  try {
    const model = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      device: 'wasm',
    });
    const result = await model(data.pcm);
    scope.postMessage({ id: data.id, text: (Array.isArray(result) ? result[0]?.text ?? '' : result.text).trim() });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
