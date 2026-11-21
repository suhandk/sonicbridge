import { test, expect, chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createModem, type ModemFactory } from '../../src/modem';
import { writeWav } from '../../src/wav';
import { crc32, encodePacket, finishBytes, Kind, offerBytes } from '../../src/protocol';

test('theme follows the system and remembers an explicit choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const theme = page.getByRole('combobox', { name: 'Theme' });
  const body = page.locator('body');
  await expect(body).toHaveCSS('color-scheme', 'dark');
  await theme.selectOption('light');
  await expect(body).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await expect(body).toHaveCSS('color-scheme', 'light');
  await theme.selectOption('system');
  await expect(body).toHaveCSS('color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(body).toHaveCSS('color-scheme', 'light');
});

test('local runtime, Unicode simulation, WAV export/import, and permission denial', async ({ page, baseURL }) => {
  const errors: string[] = [], foreign: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (new URL(r.url()).origin !== baseURL && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) foreign.push(r.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Connect through sound');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume Audio' })).toBeEnabled();
  await page.getByRole('radio', { name: 'Simulation · local PCM' }).click();
  const message = 'नमस्ते 🌉 café 日本語';
  await page.getByLabel('What would you like to send?').fill(message);
  await page.getByRole('button', { name: 'Run PCM simulation' }).click();
  await expect(page.locator('.inbox article')).toContainText(message);
  await expect(page.locator('.inbox article')).toContainText('SIMULATION / PCM');
  await expect(page.getByRole('region', { name: 'Delivery proof' })).toContainText('returned FIN_ACK through local PCM');
  await page.getByRole('button', { name: /Technical details/ }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export WAV' }).click();
  const download = await downloadEvent;
  await page.getByLabel('Import WAV').setInputFiles((await download.path())!);
  await expect(page.locator('.inbox article')).toHaveCount(2);
  await expect(page.locator('.inbox article').first()).toContainText('WAV FIXTURE');
  await expect(page.locator('.inbox article').first()).toContainText('FIN ·');
  await page.getByLabel('Import WAV').setInputFiles({ name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('bad wav') });
  await expect(page.getByRole('alert')).toContainText('Invalid WAV');
  await page.getByRole('radio', { name: 'Physical Audio', exact: true }).click();
  await page.getByLabel('What would you like to send?').fill('x'.repeat(73));
  await expect(page.getByText('Keep content to 72 bytes for a single chunk.', { exact: false })).toBeVisible();
  await page.getByLabel('What would you like to send?').fill('speaker test');
  await page.getByRole('button', { name: 'Start transmission' }).click();
  await expect(page.getByRole('status')).toContainText('HELLO');
  await page.getByRole('button', { name: 'Cancel transfer' }).click();
  await expect(page.getByRole('alert')).toContainText('cancelled', { timeout: 15000 });
  await expect(page.locator('.inbox article')).toHaveCount(2);
  await page.getByRole('radio', { name: 'Receive' }).click();
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test denied', 'NotAllowedError'); }; });
  await page.getByRole('radio', { name: 'Receive' }).click();
  await page.getByRole('button', { name: 'Listen with microphone' }).click();
  await expect(page.getByRole('alert')).toContainText('permission was denied');
  await expect(page.getByText('Microphone blocked.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Stop Audio' }).click();
  await expect(page.getByRole('button', { name: 'Start Audio', exact: true })).toBeEnabled();
  expect(errors).toEqual([]); expect(foreign).toEqual([]);
});
for (const graphRate of [44100, 48000]) {
test(`real AudioWorklet and worker decode WAV-fed microphone at ${graphRate} Hz`, async ({ baseURL }) => {
  const dir = mkdtempSync(join(tmpdir(), 'sonicbridge-'));
  const file = join(dir, 'mic.wav');
  const modem = await createModem(48000, createRequire(import.meta.url)('ggwave') as ModemFactory);
  const message = 'Microphone नमस्ते 🌉';
  const data = new TextEncoder().encode(message), checksum = crc32(data);
  const identity = { session: 41, transfer: 42 };
  const packets = [
    encodePacket({ ...identity, kind: Kind.HELLO, seq: 0, payload: offerBytes({ total: data.length, checksum, chunk: 120, maxTransfer: 4096 }) }),
    encodePacket({ ...identity, kind: Kind.DATA, seq: 0, payload: data }),
    encodePacket({ ...identity, kind: Kind.FIN, seq: 1, payload: finishBytes(data.length, checksum) }),
  ];
  const waves = packets.map(p => modem.encodeBytes(p)); modem.dispose();
  // Pause long enough for receiver CAPS and ACK speaker playback + echo guards.
  const padded = new Float32Array(48000 * (2 + 8 * 3) + waves.reduce((sum, p) => sum + p.length, 0));
  let offset = 48000 * 2;
  for (const wave of waves) { padded.set(wave, offset); offset += wave.length + 48000 * 8; }
  writeFileSync(file, Buffer.from(writeWav(padded, 48000)));
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${file}`] });
  try {
  const context = await browser.newContext({ permissions: ['microphone'], baseURL });
  await context.addInitScript(rate => {
    const Original = window.AudioContext;
    window.AudioContext = class extends Original { constructor(options?: AudioContextOptions) { super({ ...options, sampleRate: rate }); } };
  }, graphRate);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await page.getByRole('radio', { name: 'Receive' }).click();
  await page.getByRole('button', { name: 'Listen with microphone' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stop listening' })).toBeEnabled();
  await expect(page.locator('.inbox article').first()).toContainText(message, { timeout: 45000 });
  await expect(page.locator('.inbox article').first()).toContainText('MICROPHONE / VERIFIED');
  await expect(page.getByLabel('Transfer monitor')).toContainText('Verified at receiver');
  await expect(page.getByRole('region', { name: 'Delivery proof' })).toContainText('Transfer CRC32 matched. FIN_ACK queued');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await expect(page.getByRole('button', { name: 'Listen with microphone' })).toBeEnabled();
  expect(errors).toEqual([]);
  await context.close();
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});
}
test('mobile layout fits without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
});
