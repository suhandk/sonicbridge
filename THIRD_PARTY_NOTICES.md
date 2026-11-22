# Third-party notices

The production archive includes this inventory and full MIT notices in `vendor/THIRD_PARTY_NOTICES.txt`. The build takes the React-family and noble licenses directly from the locked packages. Separate copies of the ggwave and Reed–Solomon licenses also ship in `vendor/`.

| Distributed code | Attribution and license | Source |
| --- | --- | --- |
| ggwave 0.4.0, including its generated Emscripten JS and embedded WASM | Copyright (c) 2020 Georgi Gerganov. MIT. | [Release source](https://github.com/ggerganov/ggwave/tree/e035c75be1916ed8c0d1a38e823981366da3971e) |
| Reed–Solomon implementation included in ggwave | Copyright © 2015 Mike Lubinets, github.com/mersinvald. MIT. | [Included license](https://github.com/ggerganov/ggwave/blob/e035c75be1916ed8c0d1a38e823981366da3971e/src/reed-solomon/LICENSE) |
| FFT routines included in ggwave | Copyright Takuya OOURA, 1996–2001. The author permits use, copying, modification and distribution for any purpose without fee and requests a reference when modified. | [Included source](https://github.com/ggerganov/ggwave/blob/e035c75be1916ed8c0d1a38e823981366da3971e/src/fft.h) · [Author’s FFT package and terms](https://www.kurims.kyoto-u.ac.jp/~ooura/fft.html) |
| React 19.3.1, React DOM 19.3.1, Scheduler 0.28.0 | Copyright (c) Meta Platforms, Inc. and affiliates. MIT. | [React repository](https://github.com/facebook/react) |
| @noble/hashes 2.4.0 | Copyright (c) 2022 Paul Miller. MIT. | [noble-hashes](https://github.com/paulmillr/noble-hashes) |
| Transformers.js 4.3.2 and ONNX Runtime Web | Apache-2.0 and MIT, respectively. | [Transformers.js](https://github.com/huggingface/transformers) · [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE) |
| Moonshine Tiny English, quantized ONNX | Copyright (c) 2025 Useful Sensors, Inc. (dba Moonshine AI). MIT. ONNX conversion by ONNX Community, pinned to revision `a6da1241cd305dcd64eab1edbd615f2bb9aabb95`. | [Model files](https://huggingface.co/onnx-community/moonshine-tiny-ONNX/tree/a6da1241cd305dcd64eab1edbd615f2bb9aabb95) · [Upstream license](https://github.com/moonshine-ai/moonshine/blob/main/LICENSE) |

Archivo and JetBrains Mono are bundled locally through Fontsource. Both fonts use the SIL Open Font License 1.1. The production notices include their full license texts. Three.js powers the optional lunar scene under the MIT license, reproduced in the production notices.

The upstream ggwave script and the installed npm script matched byte-for-byte at SHA-256 `f3792b5c185345a35a935ca68a5064b97f979d13fbba0062ff16f6b3b31a6113`. The module-worker copy appends an export to that script. [Upstream JavaScript](https://github.com/ggerganov/ggwave/blob/e035c75be1916ed8c0d1a38e823981366da3971e/bindings/javascript/ggwave.js)

Development tools include Vite, its React plugin and Vitest (MIT), TypeScript and Playwright Test (Apache-2.0). The lockfile records the installed dependency graph. [Vite](https://github.com/vitejs/vite) · [Vitest](https://github.com/vitest-dev/vitest) · [TypeScript](https://github.com/microsoft/TypeScript) · [Playwright](https://github.com/microsoft/playwright)

The bundled lunar surface and elevation textures are resized WebP derivatives of the [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), NASA's Scientific Visualization Studio. Surface imagery comes from LRO/LROC and elevation data from LRO/LOLA.

The Earth surface texture is a resized WebP of [earth_day_4096.jpg](https://threejs.org/examples/textures/planets/earth_day_4096.jpg) from the Three.js examples.

The separate cloud layer uses a resized WebP mask from [earth_clouds_1024.png](https://threejs.org/examples/textures/planets/earth_clouds_1024.png) in the Three.js examples.
