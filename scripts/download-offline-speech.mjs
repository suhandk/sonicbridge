import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '79fb389fc764e7c395bd330e9531d9d32ada7049';
const root = new URL('../public/models/Xenova/whisper-tiny.en/', import.meta.url);
const files = [
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json',
  'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'vocab.json', 'merges.txt',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'LICENSE',
];
for (const file of files) {
  const target = new URL(file, root), path = fileURLToPath(target);
  await mkdir(dirname(path), { recursive: true });
  const url = file === 'LICENSE' ? 'https://www.apache.org/licenses/LICENSE-2.0.txt' : `https://huggingface.co/Xenova/whisper-tiny.en/resolve/${revision}/${file}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
  const hash = createHash('sha256');
  const meter = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(path));
  console.log(`${file} ${hash.digest('hex')}`);
}
