// Pruebas del núcleo del módem en Node: node test/test_modem.js
const M = require('../src/modem.js');
let fails = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + name + (extra ? '  ' + extra : '')); if (!cond) fails++; };

function receive(signal, fs, cfg, chunk = 4096) {
  const frames = [], syncs = [], aborts = [];
  const dm = new M.Demodulator(fs, cfg, { onFrame: (f) => frames.push(f), onSync: (s) => syncs.push(s), onAbort: (a) => aborts.push(a) });
  for (let o = 0; o < signal.length; o += chunk) dm.push(signal.subarray(o, Math.min(o + chunk, signal.length)));
  return { frames, syncs, aborts, dm };
}

// 1. CRC
check('CRC-16/CCITT-FALSE("123456789") = 0x29B1', M.crc16(new TextEncoder().encode('123456789')) === 0x29b1);

// 2. Lazo sin ruido con varias frecuencias de muestreo y velocidades
const msg = 'Hola, módem acústico FSK — Facultad de Ingeniería ✓';
for (const fs of [48000, 44100]) for (const baud of [50, 100, 200]) {
  const cfg = { baud };
  const fr = M.encodeText(msg, 7, cfg);
  const tx = M.modulate(fr.bits, fs, cfg);
  const ch = M.channel(tx, fs, cfg, { ebn0Db: 40, seed: baud + fs });
  const r = receive(ch.signal, fs, cfg);
  const f = r.frames[0];
  check(`Lazo fs=${fs} baud=${baud}`, r.frames.length === 1 && f.ok && f.text === msg && f.seq === 7,
    f ? `corr=${f.corr.toFixed(2)} Eb/N0 est=${f.ebn0Db.toFixed(1)}dB inicio=${f.startSample} (real ${ch.lead})` : 'sin trama');
}

// 3. Ráfaga de 5 tramas seguidas con huecos de 400 ms
{
  const fs = 48000, cfg = { baud: 100 };
  const parts = [];
  for (let s = 0; s < 5; s++) {
    parts.push(M.modulate(M.buildFrame(M.testPayload(s, 32), s, cfg).bits, fs, cfg));
    parts.push(new Float32Array(Math.round(0.4 * fs)));
  }
  const len = parts.reduce((a, p) => a + p.length, 0), x = new Float32Array(len);
  let o = 0; for (const p of parts) { x.set(p, o); o += p.length; }
  const ch = M.channel(x, fs, cfg, { ebn0Db: 25, seed: 3 });
  const r = receive(ch.signal, fs, cfg);
  check('Ráfaga de 5 tramas', r.frames.length === 5 && r.frames.every((f, i) => f.ok && f.seq === i), `recibidas=${r.frames.length} ` + r.frames.map((f) => f.seq + (f.ok ? '✓' : '✗')).join(' '));
}

// 4. Falsas alarmas: 120 s de solo ruido
{
  const fs = 48000, cfg = { baud: 100 };
  const sig = M.channel(new Float32Array(0), fs, cfg, { ebn0Db: 0, leadMs: 120000, tailMs: 0, seed: 11 }).signal;
  const r = receive(sig, fs, cfg);
  check('Sin falsas tramas en 120 s de ruido', r.frames.length === 0, `sincronías falsas=${r.syncs.length}, abortadas=${r.aborts.length}`);
}

// 5. BER con sincronía ideal contra la teoría (FSK no coherente)
{
  const fs = 48000, cfg = { baud: 100 };
  console.log('\nBER con sincronía ideal (detector) vs teoría  Pb = ½·exp(−Eb/2N0)');
  for (const eb of [4, 6, 8, 10, 12]) {
    let errs = 0, nb = 0, seed = 100 + eb;
    while ((errs < 200 && nb < 400000) || nb < 20000) {
      const rng = M.mulberry32(seed++);
      const bits = Array.from({ length: 2000 }, () => (rng() < 0.5 ? 0 : 1));
      const tx = M.modulate(bits, fs, Object.assign({}, cfg, { tailSymbols: 0, rampMs: 0 }));
      const ch = M.channel(tx, fs, cfg, { ebn0Db: eb, leadMs: 0, tailMs: 0, seed });
      const rx = M.demodAligned(ch.signal, fs, cfg, 0, bits.length);
      for (let i = 0; i < bits.length; i++) errs += rx[i] !== bits[i];
      nb += bits.length;
    }
    const th = M.berNoncoherentBFSK(eb), sim = errs / nb;
    console.log(`  Eb/N0=${String(eb).padStart(2)} dB  BER sim=${sim.toExponential(2)}  teoría=${th.toExponential(2)}  (${errs} errores / ${nb} bits)  razón=${(sim / th).toFixed(2)}`);
  }
}

// 6. Tasa de tramas correctas (sistema completo con sincronía) vs Eb/N0, eco y deriva de reloj
function per(eb, opts = {}, n = 30, payload = 32, baud = 100, mode = 'salto') {
  const fs = 48000, cfg = { baud, mode };
  let ok = 0, crc = 0, lost = 0, berE = 0, berN = 0;
  for (let s = 0; s < n; s++) {
    const pl = M.testPayload(s, payload), fr = M.buildFrame(pl, s, cfg);
    const tx = M.modulate(fr.bits, fs, cfg);
    const ch = M.channel(tx, fs, cfg, Object.assign({ ebn0Db: eb, seed: 1000 * eb + s + 1, leadMs: 200 + (s * 37) % 300 }, opts));
    const r = receive(ch.signal, fs, cfg);
    const f = r.frames.find((q) => q.seq === s) || r.frames[0];
    if (!f) { lost++; continue; }
    if (f.ok) ok++; else crc++;
    if (f.len === payload) { berE += M.bitErrors(f.payload, pl); berN += payload * 8; }
  }
  return { ok, crc, lost, n, ber: berN ? berE / berN : NaN };
}
console.log('\nTramas de 32 bytes, 100 baud, sistema completo');
for (const eb of [6, 8, 10, 12, 14, 16]) {
  const r = per(eb);
  console.log(`  Eb/N0=${String(eb).padStart(2)} dB  correctas=${r.ok}/${r.n}  CRC malo=${r.crc}  perdidas=${r.lost}  BER datos=${r.ber.toExponential(2)}`);
}
{
  console.log('\nEco y deriva a Eb/N0 = 20 dB (tramas correctas de 30)');
  for (const mode of ['simple', 'salto']) for (const baud of [50, 100, 200]) {
    const row = [0, 0.5, 1, 1.5].map((rv) => per(20, { reverb: rv }, 30, 32, baud, mode).ok);
    const dr = per(20, { driftPpm: 200 }, 30, 32, baud, mode).ok;
    console.log(`  ${mode.padEnd(6)} ${String(baud).padStart(3)} baud  eco 0/0.5/1/1.5: ${row.join(' / ')}   deriva 200 ppm: ${dr}`);
  }
  const r1 = per(20, { reverb: 0.5 }), r2 = per(20, { driftPpm: 200 });
  check('Salto de frecuencia robusto a eco moderado y deriva de 200 ppm', r1.ok >= 29 && r2.ok >= 29);
}
console.log(fails ? `\n${fails} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fails ? 1 : 0);
