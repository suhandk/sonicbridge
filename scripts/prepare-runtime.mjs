import { readFile, writeFile, mkdir } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../node_modules/ggwave/package.json', import.meta.url), 'utf8'));
if (pkg.version !== '0.4.0') throw new Error('Review modem API and limits before updating ggwave.');
const runtime = await readFile(new URL('../node_modules/ggwave/ggwave.js', import.meta.url), 'utf8');
await mkdir(new URL('../public/vendor/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/vendor/ggwave.js', import.meta.url), runtime);
// Same pinned runtime, with an explicit export for the dedicated module worker. No eval/CDN.
await writeFile(new URL('../public/vendor/ggwave-module.mjs', import.meta.url), runtime + '\nexport default ggwave_factory;\n');
const notices = [];
for (const path of ['THIRD_PARTY_NOTICES.md', 'public/vendor/LICENSE.ggwave', 'public/vendor/LICENSE.reed-solomon',
  ...['react', 'react-dom', 'scheduler', '@noble/hashes'].map(name => `node_modules/${name}/LICENSE`)]) {
  notices.push(path, await readFile(new URL('../' + path, import.meta.url), 'utf8'));
}
await writeFile(new URL('../public/vendor/THIRD_PARTY_NOTICES.txt', import.meta.url), notices.join('\n\n'));
