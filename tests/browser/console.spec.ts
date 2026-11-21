import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readWav } from '../../src/wav';

test('physical sender UI confirms a PCM peer through synthetic microphone capture', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const modemPath = '/src/modem.ts', transportPath = '/src/transport.ts';
    const { createModem, decodeBinaryFixture } = await import(modemPath) as typeof import('../../src/modem');
    const { StopAndWait } = await import(transportPath) as typeof import('../../src/transport');
    const modem = await createModem(48000);
    const originalStart = AudioBufferSourceNode.prototype.start;
    let inject: (packet: Uint8Array) => void;
    let ctx: AudioContext, microphone: MediaStreamAudioDestinationNode;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(options?: AudioContextOptions) {
        super({ ...options, sampleRate:48000 }); ctx=this;
        microphone=this.createMediaStreamDestination();
      }
    };
    navigator.mediaDevices.getUserMedia = async () => microphone.stream;
    AudioBufferSourceNode.prototype.start = function(when, offset, duration) {
      const pcm = this.buffer!.getChannelData(0).slice();
      this.addEventListener('ended', () => {
        modem.reset(); decodeBinaryFixture(modem, pcm).forEach(inject);
      }, {once:true});
      originalStart.call(this, when, offset, duration);
    };
    new StopAndWait({
      maxPacketBytes:140, subscribe(fn) { inject=fn; return () => {}; },
      async send(bytes) {
        const pcm=modem.encodeBytes(bytes), buffer=ctx.createBuffer(1,pcm.length,48000);
        buffer.copyToChannel(Float32Array.from(pcm),0);
        const source=ctx.createBufferSource(); source.buffer=buffer; source.connect(microphone);
        await new Promise<void>(resolve => { source.onended=() => {source.disconnect();resolve();}; originalStart.call(source); });
      },
    }, undefined, { content: item => { document.body.dataset.peerReceived=item.text; } });
  });
  await page.getByRole('button',{name:'Start Audio',exact:true}).click();
  await page.getByLabel('What would you like to send?').fill('Acoustic sender check');
  await page.getByRole('button',{name:'Start transmission'}).click();
  const monitor=page.getByLabel('Transfer monitor');
  await expect(monitor).toContainText('Delivery confirmed',{timeout:50000});
  await expect(page.locator('body')).toHaveAttribute('data-peer-received','Acoustic sender check');
  await expect(monitor).toContainText('21 / 21 unique content bytes acknowledged');
  await expect(monitor).toContainText('Audible Fastest · Balanced');
  await page.getByText('Packet timeline').click();
  await expect(page.locator('.timeline ol')).toContainText('FIN_ACK');
  expect(errors).toEqual([]);
});

test('keyboard, reduced motion and explicit five-second diagnostic export', async ({ page }) => {
  await page.setViewportSize({width:320,height:720});
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab'); await expect(page.getByRole('link',{name:'Skip to transfer controls'})).toBeFocused();
  await page.getByRole('button',{name:'Start Audio',exact:true}).click();
  await page.getByRole('button', {name:'↙ Receive'}).click();
  await page.getByRole('button',{name:'Listen with microphone'}).click();
  await expect(page.getByRole('heading',{name:'Listening for a nearby sender'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Resume plot'})).toBeVisible();
  await page.getByRole('button',{name:'Resume plot'}).click();
  await expect(page.locator('.scope canvas')).toBeVisible();
  await page.locator('summary').filter({hasText:'Technical details'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'Export microphone WAV'})).toHaveCount(0);
  await page.getByRole('button',{name:'Record 5 s of microphone'}).click();
  const exportButton=page.getByRole('button',{name:'Export microphone WAV'});
  await expect(exportButton).toBeVisible({timeout:10000});
  const promise=page.waitForEvent('download'); await exportButton.click();
  const file=await promise, bytes=await readFile((await file.path())!);
  const wave=readWav(Uint8Array.from(bytes).buffer);
  expect(wave.pcm.length).toBe(5*wave.sampleRate);
  await page.getByRole('button',{name:'Discard recording'}).click(); await expect(exportButton).toHaveCount(0);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const targets=await page.locator('button:visible,summary:visible,select:visible').evaluateAll(nodes => nodes.every(n => n.getBoundingClientRect().height>=44));
    expect(targets).toBe(true);
  }
});

test('engagement accepts one send and can be cancelled immediately', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Audio', exact: true }).click();
  await page.getByRole('button', { name: 'Simulation · local PCM' }).click();
  await page.getByLabel('What would you like to send?').fill('Cancel this transfer');
  const send = page.getByRole('button', { name: 'Run PCM simulation' });
  // The local clock is accelerated. Cancel on the first committed engagement frame.
  await send.evaluate(button => new Promise<void>(resolve => {
    const composer = button.closest('.composer')!;
    const observer = new MutationObserver(() => {
      if (!composer.matches('[data-engaging=true]')) return;
      const cancel = [...composer.querySelectorAll('button')].find(b => b.textContent === 'Cancel transfer' && b.offsetHeight);
      if (!cancel) return;
      observer.disconnect();
      cancel.click();
      resolve();
    });
    observer.observe(composer, { attributes: true, childList: true, subtree: true });
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  }));
  await expect(page.getByRole('alert')).toContainText(/cancel/i);
  await expect(page.locator('.inbox article')).toHaveCount(0);
  await expect(send).toBeEnabled();
  await send.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Transfer monitor')).toContainText('Delivery confirmed');
  await expect(page.locator('.inbox article')).toHaveCount(1);
});
