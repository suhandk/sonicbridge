import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = true;
env.allowRemoteModels = false;
// Transformers.js expects localModelPath to be a same-origin path, not an
// absolute HTTP URL. A namespaced model ID makes it resolve under this path.
env.localModelPath = new URL(`${import.meta.env.BASE_URL}models/`, self.location.href).pathname;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1;
const modelId = 'Xenova/whisper-tiny.en';

type WorkerMessage = { id: number; pcm: Float32Array };
const scope = self as unknown as { onmessage: (event: MessageEvent<WorkerMessage>) => void; postMessage(message: unknown): void };
let asr: Promise<Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>> | undefined;
scope.onmessage = async ({ data }) => {
  try {
    asr ??= pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      progress_callback: event => scope.postMessage({ id: data.id, progress: event }),
    });
    const model = await asr;
    const result = await model(data.pcm, { sampling_rate: 16000 });
    scope.postMessage({ id: data.id, text: result.text.trim() });
  } catch (error) {
    asr = undefined;
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  }
};
