// Prueba de extremo a extremo de la app en Chromium
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '../dist/modem_acustico.html');
const WAV = process.argv[2], SHOTS = process.argv[3];
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + WAV, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errors = []; page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(FILE); await page.waitForTimeout(800);
  const msgs = () => page.$$eval('#msgs li', (ls) => ls.map((l) => l.textContent));
  // 1. Canal simulado, mensaje
  await page.click('button[data-tab="sim"]'); await page.selectOption('#simSpeed', '16');
  await page.click('#btnSim');
  await page.waitForFunction(() => !window.__modemApp.state.sim, null, { timeout: 30000 });
  console.log('Simulado, mensaje:', (await msgs())[0]);
  // 2. Canal simulado, 10 tramas con eco fuerte
  await page.$eval('#simRv', (e) => { e.value = '1'; e.dispatchEvent(new Event('input')); });
  await page.$eval('#simEb', (e) => { e.value = '18'; e.dispatchEvent(new Event('input')); });
  await page.click('#btnSim10');
  await page.waitForFunction(() => !window.__modemApp.state.sim, null, { timeout: 60000 });
  console.log('Simulado, 10 tramas eco 1.0:', JSON.stringify(await page.evaluate(() => window.__modemApp.state.counters)));
  await page.screenshot({ path: SHOTS + '/desk_sim_dark.png', fullPage: true });
  // 3. Transmitir (sin salida de audio real) y ver que avance la trama
  await page.click('button[data-tab="tx"]'); await page.click('#btnTx'); await page.waitForTimeout(1500);
  console.log('TX cursor:', await page.evaluate(() => window.__modemApp.state.strip && window.__modemApp.state.strip.cursor), 'estado:', await page.textContent('#txStatus'));
  await page.screenshot({ path: SHOTS + '/desk_tx_dark.png' });
  await page.click('#btnStopTx');
  // 4. Micrófono falso con tramas de prueba (eco + ruido + deriva) y serie física
  await page.click('button[data-tab="rx"]');
  await page.fill('#serDist', '1'); await page.click('#btnSerStart');
  await page.click('#btnMic');
  await page.waitForTimeout(16000);
  await page.click('#btnSerEnd');
  console.log('Micrófono: pill =', await page.textContent('#micPill'), '| fs =', await page.evaluate(() => window.__modemApp.state.ctx.sampleRate));
  console.log('Serie:', await page.$eval('#serBody', (e) => e.innerText.replace(/\s+/g, ' ')));
  console.log('Últimos mensajes:', (await msgs()).slice(0, 3));
  await page.screenshot({ path: SHOTS + '/desk_rx_dark.png', fullPage: true });
  // 5. Pruebas (referencia) y modo claro
  await page.click('button[data-tab="test"]'); await page.waitForTimeout(300);
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + '/desk_test_light.png', fullPage: true });
  // 6. Móvil
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  const mp = await m.newPage(); mp.on('pageerror', (e) => errors.push('móvil: ' + e));
  await mp.goto(FILE); await mp.waitForTimeout(600);
  const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await mp.screenshot({ path: SHOTS + '/mobile_dark.png', fullPage: true });
  console.log('Desbordamiento horizontal en móvil:', ov, 'px');
  console.log('Errores de consola:', errors.length ? errors : 'ninguno');
  await browser.close();
})();
