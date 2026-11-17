/*
 * Módem acústico BFSK — núcleo sin interfaz gráfica.
 * Proyecto de Sistemas de Comunicaciones · Ingeniería en Computación · Facultad de Ingeniería.
 *
 * Trama (bits, MSB primero):
 *   PREÁMBULO 16 bits (1010…) | SYNC Barker-13 | LONGITUD 8 | SECUENCIA 8 | DATOS 8·L | CRC-16 16 | COLA (tono de marca)
 * Modulación: BFSK de fase continua. Modo "salto" (por omisión): cada símbolo usa el siguiente de 4 pares de tonos
 *             (1600/2000, 2400/2800, 3200/3600, 4000/4400 Hz) para que el eco del símbolo anterior caiga en otra
 *             frecuencia. Modo "simple": un solo par, 1800 Hz (bit 0) y 2400 Hz (bit 1).
 * Recepción: detector no coherente con filtros Goertzel (energía en el tono del 0 y en el del 1),
 *            sincronía por correlación con el patrón conocido, decisión E1 > E0, verificación CRC-16/CCITT.
 */
(function (root) {
  'use strict';

  const TONE_SETS = Object.freeze({
    salto: [[1600, 2000], [2400, 2800], [3200, 3600], [4000, 4400]],
    simple: [[1800, 2400]],
  });

  const DEFAULTS = Object.freeze({
    mode: 'salto',       // 'salto' (FH-BFSK) o 'simple' (BFSK)
    baud: 100,           // símbolos por segundo (= bits por segundo en BFSK)
    amplitude: 0.8,      // amplitud del tono a la salida (0..1)
    maxPayload: 120,     // bytes de datos por trama
    preambleBits: 16,    // 1010… para que el receptor detecte la señal
    tailSymbols: 4,      // cola de marca para vaciar las ventanas del receptor
    rampMs: 5,           // rampa de entrada/salida para evitar "clics"
    syncThreshold: 0.65, // correlación normalizada mínima para declarar sincronía
    gateDb: 5,           // la energía del preámbulo debe estar al menos 5 dB sobre el ruido promedio
    warmupMs: 150,       // tiempo para estimar el ruido antes de buscar tramas
    hopsPerSymbol: 8,    // resolución temporal del receptor (T/8)
  });

  const BARKER13 = Object.freeze([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1]);
  const FIELD_NAMES = Object.freeze({
    preamble: 'Preámbulo', sync: 'Sincronía', length: 'Longitud', seq: 'Secuencia', payload: 'Datos', crc: 'CRC-16',
  });

  const cfgOf = (c) => {
    const cfg = Object.assign({}, DEFAULTS, c || {});
    if (!cfg.pairs) cfg.pairs = TONE_SETS[cfg.mode] || TONE_SETS.salto;
    return cfg;
  };
  // Par de tonos que usa el símbolo número k de la trama
  const pairOf = (cfg, k) => cfg.pairs[k % cfg.pairs.length];

  // ---------- utilidades de bits y bytes ----------
  function preamble(n) { const b = []; for (let i = 0; i < n; i++) b.push(i % 2 === 0 ? 1 : 0); return b; }

  function bytesToBits(bytes) {
    const bits = [];
    for (const v of bytes) for (let i = 7; i >= 0; i--) bits.push((v >> i) & 1);
    return bits;
  }

  function bitsToBytes(bits) {
    const out = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < out.length; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i * 8 + j] & 1);
      out[i] = v;
    }
    return out;
  }

  // CRC-16/CCITT-FALSE: polinomio 0x1021, valor inicial 0xFFFF. crc16("123456789") = 0x29B1
  function crc16(bytes) {
    let crc = 0xffff;
    for (let k = 0; k < bytes.length; k++) {
      crc ^= bytes[k] << 8;
      for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  const utf8enc = new TextEncoder();
  const utf8dec = new TextDecoder('utf-8', { fatal: false });

  // Recorta el texto para que quepa en maxPayload bytes sin partir un carácter UTF-8
  function textToBytes(text, maxBytes) {
    let bytes = utf8enc.encode(text);
    if (bytes.length <= maxBytes) return bytes;
    let chars = Array.from(text);
    while (chars.length && utf8enc.encode(chars.join('')).length > maxBytes) chars.pop();
    return utf8enc.encode(chars.join(''));
  }
  const bytesToText = (bytes) => utf8dec.decode(bytes);

  // ---------- trama ----------
  function buildFrame(payload, seq, cfgIn) {
    const cfg = cfgOf(cfgIn);
    payload = payload instanceof Uint8Array ? payload : Uint8Array.from(payload);
    if (payload.length > cfg.maxPayload) throw new Error('La trama admite como máximo ' + cfg.maxPayload + ' bytes');
    const body = new Uint8Array(2 + payload.length);
    body[0] = payload.length; body[1] = seq & 0xff; body.set(payload, 2);
    const crc = crc16(body);
    const bits = [], fields = [];
    const add = (name, arr) => { fields.push({ name, label: FIELD_NAMES[name], start: bits.length, end: bits.length + arr.length }); for (const b of arr) bits.push(b); };
    add('preamble', preamble(cfg.preambleBits));
    add('sync', BARKER13);
    add('length', bytesToBits([body[0]]));
    add('seq', bytesToBits([body[1]]));
    add('payload', bytesToBits(payload));
    add('crc', bytesToBits([crc >> 8, crc & 0xff]));
    return { bits, fields, crc, seq: seq & 0xff, len: payload.length, payload };
  }

  function encodeText(text, seq, cfgIn) {
    const cfg = cfgOf(cfgIn);
    return buildFrame(textToBytes(text, cfg.maxPayload), seq || 0, cfg);
  }

  // Duración de una trama en segundos
  function frameSeconds(len, cfgIn) {
    const cfg = cfgOf(cfgIn);
    return (cfg.preambleBits + 13 + 16 + 8 * len + 16 + cfg.tailSymbols) / cfg.baud;
  }

  // ---------- modulador BFSK de fase continua ----------
  function modulate(bits, fs, cfgIn) {
    const cfg = cfgOf(cfgIn);
    const sym = bits.slice();
    for (let i = 0; i < cfg.tailSymbols; i++) sym.push(1);
    const sps = fs / cfg.baud;
    const total = Math.round(sym.length * sps);
    const y = new Float32Array(total);
    const W = cfg.pairs.map((p) => p.map((f) => (2 * Math.PI * f) / fs)), K = W.length, A = cfg.amplitude;
    let phase = 0, k = 0, next = Math.round(sps);
    for (let n = 0; n < total; n++) {
      while (n >= next) { k++; next = Math.round((k + 1) * sps); }
      y[n] = A * Math.sin(phase);
      phase += W[k % K][sym[k]];
      if (phase > 2 * Math.PI) phase -= 2 * Math.PI;
    }
    const R = Math.min(Math.round((cfg.rampMs * fs) / 1000), Math.floor(total / 2));
    for (let n = 0; n < R; n++) { const g = 0.5 - 0.5 * Math.cos((Math.PI * n) / R); y[n] *= g; y[total - 1 - n] *= g; }
    return y;
  }

  // ---------- Goertzel ----------
  function goertzelArr(x, start, N, coeff) {
    let s1 = 0, s2 = 0;
    for (let n = 0; n < N; n++) { const s = x[start + n] + coeff * s1 - s2; s2 = s1; s1 = s; }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
  }

  // Demodulación con temporización conocida (para medir la BER del detector, "con sincronía ideal")
  function demodAligned(x, fs, cfgIn, startSample, nbits) {
    const cfg = cfgOf(cfgIn);
    const sps = fs / cfg.baud, N = Math.round(sps);
    const C = cfg.pairs.map((p) => p.map((f) => 2 * Math.cos((2 * Math.PI * f) / fs)));
    const bits = new Uint8Array(nbits);
    for (let k = 0; k < nbits; k++) {
      const s = Math.round(startSample + k * sps), c = C[k % C.length];
      bits[k] = goertzelArr(x, s, N, c[1]) > goertzelArr(x, s, N, c[0]) ? 1 : 0;
    }
    return bits;
  }

  // ---------- demodulador en flujo (tiempo real) ----------
  class Demodulator {
    constructor(fs, cfgIn, handlers) {
      this.cfg = cfgOf(cfgIn);
      this.fs = fs;
      this.h = handlers || {};
      this.sps = fs / this.cfg.baud;
      this.N = Math.round(this.sps);
      this.H = this.cfg.hopsPerSymbol;
      this.hop = this.sps / this.H;
      this.K = this.cfg.pairs.length;
      this.C = this.cfg.pairs.map((p) => p.map((f) => 2 * Math.cos((2 * Math.PI * f) / fs)));
      this.cap = 1 << 17; this.mask = this.cap - 1; this.ring = new Float32Array(this.cap);
      this.HL = 2048; this.hm = this.HL - 1;
      this.dH = this.C.map(() => new Float32Array(this.HL));   // métrica de decisión por par de tonos
      this.eH = this.C.map(() => new Float32Array(this.HL));   // energía por par de tonos
      this.nH = new Float32Array(this.HL);                     // piso de ruido
      const pre = preamble(this.cfg.preambleBits);
      this.pattern = pre.slice(-8).concat(BARKER13).map((b) => (b ? 1 : -1)); // 8 últimos bits del preámbulo + Barker
      this.P = this.pattern.length;
      this.patPair = this.pattern.map((_, k) => (this.cfg.preambleBits - 8 + k) % this.K);
      this.dataOffset = this.cfg.preambleBits + 13;            // índice del primer símbolo después de la sincronía
      this.gateLin = Math.pow(10, this.cfg.gateDb / 10);
      const hopsPerSec = this.H * this.cfg.baud;
      this.alpha = 1 / (0.5 * hopsPerSec);                       // promedio del ruido con constante de 0.5 s
      this.upRate = Math.pow(10, 1 / (3 * hopsPerSec));          // si el ruido aumenta, la estimación sube 10 dB cada 3 s
      this.warmHops = Math.round((this.cfg.warmupMs / 1000) * hopsPerSec);
      this.tinyE = Math.pow(this.N / 2, 2) * 1e-10;               // por debajo de esto es silencio digital (≈ −100 dB de un tono a escala completa)
      this.stats = { frames: 0, ok: 0, crcErr: 0, aborted: 0, syncs: 0 };
      this.p = new Float64Array(2 * this.K);
      this.reset();
    }

    reset() {
      this.total = 0; this.m = 0; this.noise = null; this.noiseHops = 0;
      this.state = 'search'; this.cand = null; this.frame = null;
      this.last = { p: new Float64Array(2 * this.K), d: 0, corr: 0, energy: 0, noise: 0, pair: 0, m: 0, sample: 0 };
    }

    // Amplitud estimada de un tono a partir de la potencia de Goertzel
    amp(p) { return (2 * Math.sqrt(Math.max(p, 0))) / this.N; }

    push(x) {
      if (x.length > 16384) { for (let o = 0; o < x.length; o += 16384) this.push(x.subarray(o, Math.min(o + 16384, x.length))); return; }
      const r = this.ring, mk = this.mask, base = this.total;
      for (let i = 0; i < x.length; i++) r[(base + i) & mk] = x[i];
      this.total += x.length;
      for (;;) {
        const start = Math.round(this.m * this.hop);
        if (start + this.N > this.total) break;
        this._hop(start);
        this.m++;
      }
    }

    _g(start, c) {
      const r = this.ring, mk = this.mask, N = this.N;
      let s1 = 0, s2 = 0;
      for (let n = 0; n < N; n++) { const s = r[(start + n) & mk] + c * s1 - s2; s2 = s1; s1 = s; }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    }

    _hop(start) {
      this._hopCore(start);
      if (this.h.onHop) this.h.onHop(this.last, this.state);
    }

    _hopCore(start) {
      const m = this.m, hm = this.hm, H = this.H, P = this.P, K = this.K, p = this.p;
      let eAll = 0;
      for (let j = 0; j < K; j++) {
        const p0 = this._g(start, this.C[j][0]), p1 = this._g(start, this.C[j][1]);
        p[2 * j] = p0; p[2 * j + 1] = p1;
        const e = p0 + p1 + 1e-12;
        this.dH[j][m & hm] = (p1 - p0) / e; this.eH[j][m & hm] = e; eAll += e;
      }
      eAll /= K;
      // Estimación del ruido: promedio de la energía cuando no hay señal; se congela mientras se recibe una trama
      // El silencio digital (ceros exactos al abrir el micrófono) no cuenta como ruido
      if (this.noise === null) { if (eAll > this.tinyE) { this.noise = eAll; this.noiseHops = 1; } }
      else if (this.state === 'search') {
        this.noiseHops++;
        const a = Math.max(this.alpha, 1 / this.noiseHops);    // al inicio es un promedio acumulado
        if (eAll < 2 * this.noise) this.noise += (eAll < 0.5 * this.noise ? Math.max(a, 0.1) : a) * (eAll - this.noise);
        else this.noise *= this.upRate;
      }
      this.nH[m & hm] = this.noise === null ? 0 : this.noise;
      const L = this.last; L.p.set(p); L.energy = eAll; L.noise = this.noise || 0; L.m = m; L.sample = start;

      if (this.state === 'search') {
        const need = (P - 1) * H;
        if (m < need + 2 * H || this.noise === null || this.noiseHops < this.warmHops) { L.corr = 0; L.d = 0; return; }
        let c = 0, es = 0;
        for (let k = 0; k < P; k++) {
          const i = (m - (P - 1 - k) * H) & hm, j = this.patPair[k];
          c += this.pattern[k] * this.dH[j][i]; es += this.eH[j][i];
        }
        c /= P; es /= P;
        const nf = this.noise;                                 // ruido estimado antes de la señal (casi no sube durante el preámbulo)
        L.corr = c; L.pair = this.patPair[P - 1]; L.d = this.dH[L.pair][m & hm];
        if (c >= this.cfg.syncThreshold && es >= nf * this.gateLin && (!this.cand || c > this.cand.c)) this.cand = { m, c, es, nf };
        if (this.cand && m - this.cand.m >= H / 2) this._lock(this.cand);
      } else if (this.state === 'data') {
        const f = this.frame, k = m - f.m0;
        if (k > 0 && k % H === 0) {
          const j = (this.dataOffset + f.bits.length) % K;
          L.pair = j; L.d = this.dH[j][m & hm];
          this._symbol(this.dH[j][m & hm], this.eH[j][m & hm]);
        }
      }
    }

    _lock(c) {
      const H = this.H, P = this.P;
      this.state = 'data'; this.cand = null; this.stats.syncs++;
      this.frame = {
        m0: c.m, corr: c.c, nf: c.nf, es: c.es, bits: [], soft: [], len: null, seq: null, need: 16, weak: 0, esum: 0,
        startSample: Math.round((c.m - (P - 1) * H) * this.hop) - (this.cfg.preambleBits - 8) * this.N,
      };
      if (this.h.onSync) this.h.onSync({ corr: c.c, ebn0Db: this.ebn0Db(c.es, c.nf), startSample: this.frame.startSample, sample: Math.round(c.m * this.hop) });
    }

    // Eb/N0 estimado: energía del par activo = señal + 2 bins de ruido; ruido promedio = 2 bins → Eb/N0 ≈ 2·(es/nf − 1)
    ebn0Db(es, nf) { return 10 * Math.log10(Math.max(2 * (es / Math.max(nf, 1e-12) - 1), 1e-3)); }

    _symbol(d, e) {
      const f = this.frame, bit = d > 0 ? 1 : 0;
      f.bits.push(bit); f.soft.push(d); f.esum += e;
      const idx = f.bits.length - 1;
      f.weak = e < f.nf * 2 ? f.weak + 1 : 0;
      const field = idx < 8 ? 'length' : idx < 16 ? 'seq' : f.len !== null && idx < 16 + 8 * f.len ? 'payload' : 'crc';
      if (this.h.onBit) this.h.onBit({ index: idx, bit, soft: d, field, pair: (this.dataOffset + idx) % this.K, sample: Math.round(this.m * this.hop) });
      if (f.weak >= 24) return this._abort('Se perdió la portadora');
      if (f.bits.length === 16) {
        const hb = bitsToBytes(f.bits);
        f.len = hb[0]; f.seq = hb[1];
        if (f.len > this.cfg.maxPayload) return this._abort('Longitud inválida (' + f.len + ')');
        f.need = 16 + 8 * f.len + 16;
        if (this.h.onHeader) this.h.onHeader({ len: f.len, seq: f.seq });
      }
      if (f.len !== null && f.bits.length >= f.need) this._finish();
    }

    _abort(reason) {
      this.stats.aborted++;
      const f = this.frame;
      this.state = 'search'; this.frame = null;
      if (this.h.onAbort) this.h.onAbort({ reason, bits: f ? f.bits.length : 0 });
    }

    _finish() {
      const f = this.frame;
      const bytes = bitsToBytes(f.bits);
      const body = bytes.subarray(0, 2 + f.len);
      const rx = (bytes[2 + f.len] << 8) | bytes[3 + f.len];
      const calc = crc16(body);
      const ok = rx === calc;
      const payload = bytes.slice(2, 2 + f.len);
      this.stats.frames++; if (ok) this.stats.ok++; else this.stats.crcErr++;
      const meanE = f.esum / f.bits.length;
      const res = {
        ok, len: f.len, seq: f.seq, payload, text: bytesToText(payload), crcRx: rx, crcCalc: calc,
        bits: f.bits.slice(), soft: f.soft.slice(), corr: f.corr, ebn0Db: this.ebn0Db(meanE, f.nf),
        startSample: f.startSample, endSample: Math.round(this.m * this.hop) + this.N,
        meanConfidence: f.soft.reduce((a, v) => a + Math.abs(v), 0) / f.soft.length,
      };
      this.state = 'search'; this.frame = null;
      if (this.h.onFrame) this.h.onFrame(res);
      return res;
    }
  }

  // ---------- canal simulado ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussFactory(rng) {
    let spare = null;
    return function () {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0; while (u === 0) u = rng(); v = rng();
      const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
      spare = r * Math.sin(th); return r * Math.cos(th);
    };
  }

  // Varianza del ruido por muestra para un Eb/N0 dado (energías discretas: Eb = A²/2·sps, N0/2 = σ²)
  function noiseSigma(ebn0Db, fs, cfgIn) {
    const cfg = cfgOf(cfgIn), sps = fs / cfg.baud, A = cfg.amplitude;
    return Math.sqrt((A * A * sps) / (4 * Math.pow(10, ebn0Db / 10)));
  }
  // SNR por muestra (banda completa) equivalente a un Eb/N0
  function snrFromEbN0(ebn0Db, fs, cfgIn) { const cfg = cfgOf(cfgIn); return ebn0Db + 10 * Math.log10((2 * cfg.baud) / fs); }

  function channel(x, fs, cfgIn, opt) {
    const cfg = cfgOf(cfgIn);
    opt = Object.assign({ ebn0Db: 30, reverb: 0, driftPpm: 0, gain: 1, leadMs: 300, tailMs: 300, seed: 1 }, opt || {});
    const rng = mulberry32(opt.seed), gauss = gaussFactory(rng);
    let y = x;
    if (opt.driftPpm) {                       // diferencia de reloj entre tarjetas de sonido
      const r = 1 + opt.driftPpm * 1e-6, n = Math.floor((x.length - 1) / r), z = new Float32Array(n);
      for (let i = 0; i < n; i++) { const t = i * r, i0 = Math.floor(t), a = t - i0; z[i] = x[i0] * (1 - a) + x[i0 + 1] * a; }
      y = z;
    }
    if (opt.reverb > 0) {                     // eco de la habitación: reflexiones con decaimiento exponencial
      const taps = [];
      for (let i = 0; i < 14; i++) {
        const ms = 2 + rng() * 70;
        taps.push({ D: Math.round((ms * fs) / 1000), g: opt.reverb * 0.8 * Math.exp(-ms / 25) * (rng() < 0.5 ? -1 : 1) });
      }
      const z = new Float32Array(y.length);
      for (let n = 0; n < y.length; n++) {
        let s = y[n];
        for (const t of taps) if (n >= t.D) s += t.g * y[n - t.D];
        z[n] = s;
      }
      y = z;
    }
    const lead = Math.round((opt.leadMs * fs) / 1000), tail = Math.round((opt.tailMs * fs) / 1000);
    const out = new Float32Array(lead + y.length + tail);
    const sigma = noiseSigma(opt.ebn0Db, fs, cfg) * opt.gain;
    for (let n = 0; n < out.length; n++) {
      const s = n >= lead && n < lead + y.length ? y[n - lead] * opt.gain : 0;
      out[n] = s + sigma * gauss();
    }
    return { signal: out, lead, sigma };
  }

  // ---------- teoría ----------
  function erfc(x) {                          // Numerical Recipes, error relativo < 1.2e-7
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const berNoncoherentBFSK = (ebn0Db) => 0.5 * Math.exp(-Math.pow(10, ebn0Db / 10) / 2);
  const berCoherentBFSK = (ebn0Db) => 0.5 * erfc(Math.sqrt(Math.pow(10, ebn0Db / 10) / 2));

  // ---------- datos de prueba conocidos (para contar bits erróneos) ----------
  const TEST_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function testPayload(seq, len) {
    const rng = mulberry32(0x5eed + seq * 7919), out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = TEST_ALPHABET.charCodeAt(Math.floor(rng() * 64));
    return out;
  }
  function bitErrors(a, b) {
    let e = 0; const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { let v = a[i] ^ b[i]; while (v) { e += v & 1; v >>= 1; } }
    return e + 8 * Math.abs(a.length - b.length);
  }

  // ---------- experimentos de simulación (los usan la app y las pruebas en Node) ----------
  // Errores de bit del detector con temporización ideal
  function berTrial(ebn0Db, fs, cfgIn, nbits, seed) {
    const cfg = cfgOf(cfgIn), rng = mulberry32(seed);
    const bits = []; for (let i = 0; i < nbits; i++) bits.push(rng() < 0.5 ? 0 : 1);
    const tx = modulate(bits, fs, Object.assign({}, cfg, { tailSymbols: 0, rampMs: 0 }));
    const ch = channel(tx, fs, cfg, { ebn0Db, leadMs: 0, tailMs: 0, seed: (seed ^ 0x9e3779b9) | 0 });
    const rx = demodAligned(ch.signal, fs, cfg, 0, nbits);
    let e = 0; for (let i = 0; i < nbits; i++) e += rx[i] !== bits[i];
    return e;
  }
  // Una trama completa por el canal simulado y el receptor en flujo (sincronía incluida)
  function frameTrial(ebn0Db, fs, cfgIn, seq, payloadLen, chOpts, seed) {
    const cfg = cfgOf(cfgIn), pl = testPayload(seq, payloadLen), fr = buildFrame(pl, seq, cfg);
    const tx = modulate(fr.bits, fs, cfg);
    const ch = channel(tx, fs, cfg, Object.assign({ ebn0Db, seed, leadMs: 200 + ((seed * 37) % 300 + 300) % 300 }, chOpts || {}));
    let got = null;
    const dm = new Demodulator(fs, cfg, { onFrame: (f) => { if (!got) got = f; } });
    dm.push(ch.signal);
    if (!got) return { status: 'lost', bitErrors: null, ebn0Est: null };
    return { status: got.ok ? 'ok' : 'crc', bitErrors: got.len === payloadLen ? bitErrors(got.payload, pl) : null, ebn0Est: got.ebn0Db };
  }

  // ---------- WAV PCM de 16 bits ----------
  function encodeWav(x, fs) {
    const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, fs, true);
    v.setUint32(28, fs * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, x.length * 2, true);
    for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
    return buf;
  }

  const api = {
    DEFAULTS, TONE_SETS, BARKER13, FIELD_NAMES, cfgOf, pairOf, preamble, bytesToBits, bitsToBytes, crc16, textToBytes, bytesToText,
    buildFrame, encodeText, frameSeconds, modulate, demodAligned, Demodulator, channel, noiseSigma, snrFromEbN0,
    mulberry32, gaussFactory, erfc, berNoncoherentBFSK, berCoherentBFSK, testPayload, bitErrors, encodeWav, goertzelArr,
    berTrial, frameTrial,
  };
  root.Modem = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
