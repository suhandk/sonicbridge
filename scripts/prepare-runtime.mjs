import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../node_modules/ggwave/package.json', import.meta.url), 'utf8'));
if (pkg.version !== '0.4.0') throw new Error('Review modem API and limits before updating ggwave.');
const runtime = await readFile(new URL('../node_modules/ggwave/ggwave.js', import.meta.url), 'utf8');
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/vendor/ggwave.js', import.meta.url), runtime);
// Same pinned runtime, with an explicit export for the dedicated module worker. No eval/CDN.
await writeFile(new URL('../public/vendor/ggwave-module.mjs', import.meta.url), runtime + '\nexport default ggwave_factory;\n');
const speechRuntime = new URL('../public/speech-runtime/', import.meta.url);
await mkdir(speechRuntime, { recursive: true });
for (const extension of ['mjs', 'wasm']) {
  const name = `ort-wasm-simd-threaded.${extension}`;
  await copyFile(new URL(`../node_modules/onnxruntime-web/dist/${name}`, import.meta.url), new URL(name, speechRuntime));
}
const notices = [];
for (const path of ['THIRD_PARTY_NOTICES.md', 'public/vendor/LICENSE.ggwave', 'public/vendor/LICENSE.reed-solomon', 'public/vendor/LICENSE.onnxruntime', 'public/vendor/LICENSE.moonshine',
  ...['three', '@fontsource-variable/archivo', '@fontsource/jetbrains-mono', 'react', 'react-dom', 'scheduler', '@noble/hashes', '@huggingface/transformers'].map(name => `node_modules/${name}/LICENSE`)]) {
  notices.push(path, await readFile(new URL('../' + path, import.meta.url), 'utf8'));
}
await writeFile(new URL('../public/vendor/THIRD_PARTY_NOTICES.txt', import.meta.url), notices.join('\n\n'));

const documents = ['PROTOCOL','AUDIO','PROJECT','DEVICE_TEST_MATRIX','STATUS','BENCHMARKS','PHYSICAL_TEST_SHEET','CONTRIBUTIONS','THIRD_PARTY_NOTICES'];
await mkdir(new URL('../public/docs/', import.meta.url), { recursive: true });
for (const name of documents) {
  const source = await readFile(new URL('../'+name+'.md', import.meta.url));
  await writeFile(new URL('../public/docs/'+name+'.txt', import.meta.url), source);
}
