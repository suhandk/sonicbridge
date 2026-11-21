# Trusted HTTPS for phone testing

The first load/install downloads application assets. Later message bodies, calibration, negotiation, ACKs, cancellation and recovery travel as sound. An installed/cached app can reload offline; installation does not grant microphone permission or bypass browser audio activation. Wait for **Offline app ready**, then test offline reload before disabling connectivity.

A phone opening `http://192.168.x.x:5173` is not using localhost and normally cannot access microphone or service-worker APIs. Clicking through an untrusted-certificate warning is not a reliable substitute for a trusted secure context. The phone must recognize the server's certificate chain and the certificate must include the hostname/IP actually used.

## Local private-network setup

These are preparation instructions; this task has not installed certificates, changed firewall/trust settings, or published the app. Use a laptop and phone on the same private Wi-Fi, without guest/client isolation.

1. Install [mkcert from its official project](https://github.com/FiloSottile/mkcert). On Windows its README lists supported installers/releases. In PowerShell, from the project folder, generate a local certificate for your laptop's current LAN IP:

   ```powershell
   Set-Location D:\projects\soundbridge
   # Replace this example with the laptop's Wi-Fi IPv4 address from ipconfig.
   $sonicbridgeTestIp = '192.168.1.50'
   mkcert -install
   New-Item -ItemType Directory -Force .certs
   mkcert -cert-file .certs/sonicbridge.pem -key-file .certs/sonicbridge-key.pem localhost 127.0.0.1 ::1 $sonicbridgeTestIp
   mkcert -CAROOT
   ```

2. The last command prints the CA directory. Install **only its public `rootCA.pem` certificate** on the test phone using a file-transfer method you control. Keep `rootCA-key.pem` and the server private key private; neither belongs in dist or on the phone. mkcert documents mobile CA installation. On iPhone, install the downloaded configuration profile, then enable full trust for that root in Settings → General → About → Certificate Trust Settings. On Android, install it as a CA certificate through the device's credential/security settings; exact menus and enterprise restrictions vary. Verify the browser actually trusts it. Managed devices may prohibit this. If the browser still warns or reports an insecure context, stop and correct certificate trust/name/IP rather than assuming microphone access works.

3. Build and start the included static HTTPS server:

   ```powershell
   npm ci
   npm run build
   npm run serve:https
   ```

   It binds port **8443**, serving only dist. It expects `.certs/sonicbridge.pem` and `.certs/sonicbridge-key.pem`; `.certs` is ignored by Git. Custom paths can be supplied with `SONICBRIDGE_CERT` and `SONICBRIDGE_KEY`. A missing certificate is an explicit startup error. Allow the server on the private network if Windows prompts; no firewall rule is changed automatically.

4. Open `https://192.168.1.50:8443/` on the phone using the actual certified IP. Confirm there is no trust warning, the app loads, and **Start Audio** can activate sound. On both devices choose a microphone, grant permission, and inspect effective rates/processing settings. Device labels may appear only after permission; press Refresh devices if needed. Some browsers only permit the OS default output, so use the phone/OS route picker and recalibrate after switching.

5. Wait for **Offline app ready**. Install using the browser menu or on iPhone Safari Share → Add to Home Screen. Reload once with connectivity disabled. The service worker caches the application shell, both local ggwave JS variants (with embedded WASM), worker, worklet, styles, icons and manifest. First-ever offline visits cannot work, and the OS/browser may evict cached storage later. Return to the exact same HTTPS origin/port; a different IP or port is a different installation/storage origin. Disable radios if desired only after setup, keeping audio permissions and the page active.

6. On the second device tap **Arm calibration receiver**; on the first tap **Calibrate link**. Keep both pages foregrounded and both screens unlocked. The fresh nonce travels through two complete reliable acoustic transfers, one in each direction. Calibration must report a verified bidirectional challenge; local speaker playback alone is insufficient. Start at moderate OS volume and the restrained default app gain; increase gradually only if needed. Then run the test cases in DEVICE_TEST_MATRIX.md.

If DHCP changes the laptop's IP, regenerate the certificate with the new address and revisit that HTTPS origin. Removing the testing CA afterward is an OS settings action. No CA removal or trust-store changes are automated here.

## Static-host alternative (prepared, not published)

The entire dist folder can be served at the root of a normal trusted HTTPS static host. `hosting/README.md` and `hosting/_headers` specify MIME types, cache rules and permissions/CSP. No payload backend is needed. The pinned Emscripten binding uses generated function wrappers, so the prepared CSP explicitly allows its required `unsafe-eval` while restricting script sources to the same origin. Do not omit vendor or worker files, rewrite missing scripts to HTML, or make sw.js/HTML immutable.

The loopback-only `node scripts/serve-https.mjs --http-test --port 4173` mode exists for automated production/offline software tests. Its `http://localhost` secure-context exception does **not** apply to a phone's LAN URL. No production host has been connected or published.

References checked 2026-11-20: [getUserMedia secure-context requirement](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [mkcert mobile guidance](https://github.com/FiloSottile/mkcert#mobile-devices), [Apple manual certificate trust](https://support.apple.com/en-us/102390), [WebKit Home Screen app installation](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
