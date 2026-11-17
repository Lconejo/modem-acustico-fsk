// Genera los resultados de referencia que muestra la app y que usa el artículo: node test/reference.js > dist/reference.json
const M = require('../src/modem.js');
const fs = 48000, FRAMES = 50, PAYLOAD = 32;
const out = { generated: new Date().toISOString(), fs, frames: FRAMES, payload: PAYLOAD, ber: [], per: [], echo: [], baud: [] };
for (let eb = 0; eb <= 14; eb += 1) {                       // BER del detector (sincronía ideal)
  let e = 0, n = 0, seed = 1 + eb * 1000;
  while ((e < 300 && n < 600000) || n < 40000) { e += M.berTrial(eb, fs, { baud: 100 }, 4000, seed++); n += 4000; }
  out.ber.push({ ebn0: eb, errors: e, bits: n, ber: e / n, theory: M.berNoncoherentBFSK(eb), coherent: M.berCoherentBFSK(eb) });
  console.error('ber', eb, e / n);
}
const runFrames = (eb, cfg, ch, seed0) => {
  const r = { ok: 0, crc: 0, lost: 0, bitErr: 0, bitN: 0, ebSum: 0, ebN: 0 };
  for (let s = 0; s < FRAMES; s++) {
    const t = M.frameTrial(eb, fs, cfg, s, PAYLOAD, ch, seed0 + s);
    r[t.status]++;
    if (t.bitErrors !== null) { r.bitErr += t.bitErrors; r.bitN += PAYLOAD * 8; }
    if (t.ebn0Est !== null) { r.ebSum += t.ebn0Est; r.ebN++; }
  }
  return { ok: r.ok, crc: r.crc, lost: r.lost, n: FRAMES, per: 1 - r.ok / FRAMES, ber: r.bitN ? r.bitErr / r.bitN : null, ebn0Est: r.ebN ? r.ebSum / r.ebN : null };
};
for (let eb = 6; eb <= 20; eb += 2) {                     // tramas completas vs Eb/N0
  const r = runFrames(eb, { baud: 100, mode: 'salto' }, {}, 5000 + eb * 100);
  out.per.push(Object.assign({ ebn0: eb, theoryPer: 1 - Math.pow(1 - M.berNoncoherentBFSK(eb), 8 * PAYLOAD + 32) }, r));
  console.error('per', eb, r.ok);
}
for (const mode of ['simple', 'salto']) for (const reverb of [0, 0.5, 1, 1.5]) { // eco
  const r = runFrames(20, { baud: 100, mode }, { reverb }, 9000 + reverb * 100);
  out.echo.push(Object.assign({ mode, reverb }, r));
  console.error('eco', mode, reverb, r.ok);
}
for (const baud of [50, 100, 200]) for (const reverb of [0.5, 1]) {     // velocidad vs eco (modo salto)
  const r = runFrames(20, { baud, mode: 'salto' }, { reverb }, 12000 + baud + reverb * 10);
  out.baud.push(Object.assign({ baud, reverb }, r));
  console.error('baud', baud, reverb, r.ok);
}
const d = runFrames(20, { baud: 100, mode: 'salto' }, { driftPpm: 200 }, 15000);
out.drift = Object.assign({ ppm: 200 }, d);
console.log(JSON.stringify(out));
