# Prepared static hosting assets — not published

Build with `npm ci` then `npm run build`. Deploy the entire `dist` directory at the HTTPS origin root, including sw.js, offline-assets.json, manifest, icons, vendor JS/embedded WASM, module worker, capture worklet, CSS, and hashed application assets. No backend/API/database is required. Nothing has been published by this task.

`sonicbridge-static.zip` is the prepared local archive of the current production build plus `_headers`. All 16 build files were checked against archive entries by SHA-256. It contains no certificates or private keys. Rebuild/repackage after source changes; this archive is a reviewable hosting artifact, not a deployment.

For a host supporting `_headers`, copy this directory's `_headers` file into dist **after building**. For other hosts translate it to that host's configuration. Ensure .mjs/.js serve as JavaScript, .wasm as application/wasm if a future runtime separates WASM, and .webmanifest as application/manifest+json. Do not rewrite missing script/worker URLs to HTML; return 404. The bundled runtime embeds WASM inside both local JS variants.

The CSP permits unsafe-eval because the pinned upstream Emscripten binding uses new Function to name binding wrappers. All scripts remain same-origin; removing this permission without rebuilding/revalidating the runtime will break it. Inline styles are used for signal bars and meter widths. The included local HTTPS server sends this same policy, and production tests exercise it.

Do not cache sw.js or HTML as immutable. The generated service worker precaches the exact entire build, installs atomically, and waits for a visible stop-and-reload action before taking over an existing controlled app. One previous cache is retained for older hashed assets. Updating is not publishing; no host connection is configured here.

Use `npm run serve:https` with a trusted local certificate for phone trials; see ../HTTPS.md. The `--http-test` server option binds only to loopback for software tests and is not a phone testing solution.
