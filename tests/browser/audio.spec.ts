import { expect, test } from '@playwright/test';
test('effective processing requests, real context suspension, route events and background cleanup require a fresh gesture', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original { constructor(options?: AudioContextOptions) { super(options); w.testContext = this; } };
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker { constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (String(url).includes('modem-worker')) w.testWorker = this; } };
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { w.testConstraints = constraints; const stream = await gum(constraints); w.testTracks = stream.getTracks(); return stream; };
    const getSettings = MediaStreamTrack.prototype.getSettings;
    MediaStreamTrack.prototype.getSettings = function () { return { ...getSettings.call(this), echoCancellation: true, noiseSuppression: false, autoGainControl: undefined }; };
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await page.getByRole('button', { name: 'Listen with microphone' }).click();
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeEnabled();
  await expect(page.locator('.processing-report')).toContainText('request ignored');
  await expect(page.locator('.processing-report')).toContainText('does not disclose');
  expect(await page.evaluate(() => (window as any).testConstraints.audio.echoCancellation.ideal)).toBe(false);
  expect(await page.getByLabel('Playback gain').inputValue()).toBe('0.6');
  await page.evaluate(async () => { await (window as any).testContext.suspend(); });
  await expect(page.getByRole('alert')).toContainText('context suspended');
  await expect(page.getByRole('button', { name: 'Start Audio', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).testTracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Audio' })).toBeEnabled();
  await page.evaluate(() => (window as any).testContext.dispatchEvent(new Event('sinkchange')));
  await expect(page.getByRole('alert')).toContainText('Output route changed');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Audio' })).toBeEnabled();
  expect(await page.evaluate(() => typeof (window as any).testWorker?.onmessageerror)).toBe('function');
  await page.evaluate(() => (window as any).testWorker.dispatchEvent(new ErrorEvent('error', { message: 'Test idle DSP failure', cancelable: true })));
  await expect(page.getByRole('alert')).toContainText('DSP worker stopped');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Audio' })).toBeEnabled();
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.getByRole('alert')).toContainText('Page backgrounded');
  await expect(page.getByRole('button', { name: 'Start Audio', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});
test('stopping while microphone permission is pending closes the late stream', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await page.evaluate(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => new Promise(resolve => { (window as any).resolveMicrophone = async () => { const stream = await gum(constraints); (window as any).lateTracks = stream.getTracks(); resolve(stream); }; });
  });
  await page.getByRole('button', { name: 'Listen with microphone' }).click();
  await expect(page.getByRole('status')).toContainText('Requesting microphone');
  await page.getByRole('button', { name: 'Stop Audio' }).click();
  await page.evaluate(async () => { await (window as any).resolveMicrophone(); });
  await expect(page.getByRole('alert')).toContainText('startup cancelled');
  expect(await page.evaluate(() => (window as any).lateTracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
});
test('actual Web Audio resampling between 48 and 44.1 kHz remains decodable by the modem', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/modem.ts';
    const { createModem, decodeBinaryFixture } = await import(path) as typeof import('../../src/modem');
    const results: boolean[] = [];
    for (const [txRate, rxRate] of [[48000, 44100], [44100, 48000]]) {
      const tx = await createModem(txRate), rx = await createModem(rxRate);
      try {
        const bytes = Uint8Array.from({ length: 140 }, (_, i) => (i * 31) & 255);
        const pcm = tx.encodeBytes(bytes);
        const context = new OfflineAudioContext(1, Math.ceil(pcm.length * rxRate / txRate) + rxRate, rxRate);
        const buffer = context.createBuffer(1, pcm.length, txRate); buffer.copyToChannel(Float32Array.from(pcm), 0);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
        const rendered = await context.startRendering();
        const decoded = decodeBinaryFixture(rx, rendered.getChannelData(0));
        results.push(decoded.length === 1 && bytes.every((b, i) => decoded[0][i] === b));
      } finally { tx.dispose(); rx.dispose(); }
    }
    return results;
  });
  expect(result).toEqual([true, true]);
});
