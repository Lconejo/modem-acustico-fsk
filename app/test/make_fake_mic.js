// Genera un WAV que se usa como "micrófono falso" en Chromium: 3 tramas de prueba con eco y ruido
const M = require('../src/modem.js'); const fsys = require('fs');
const fs = 48000, cfg = { baud: 100, mode: 'salto' }, parts = []; let off = Math.round(1.0 * fs);
for (let s = 0; s < 3; s++) { const w = M.modulate(M.buildFrame(M.testPayload(s, 32), s, cfg).bits, fs, cfg); parts.push({ w, off }); off += w.length + Math.round(0.7 * fs); }
const x = new Float32Array(off + fs); for (const p of parts) x.set(p.w, p.off);
const ch = M.channel(x, fs, cfg, { ebn0Db: 22, reverb: 0.6, driftPpm: 80, leadMs: 0, tailMs: 0, seed: 77, gain: 0.5 });
let pk = 0; for (const v of ch.signal) pk = Math.max(pk, Math.abs(v)); const y = ch.signal.map((v) => (v / pk) * 0.7);
fsys.writeFileSync(process.argv[2], Buffer.from(M.encodeWav(y, fs)));
console.log('wav', (y.length / fs).toFixed(1), 's');
