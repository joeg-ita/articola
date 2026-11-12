// Audio side of the metrics, measured in the browser on the recorded clip (nothing leaves the device for this):
//  - speech vs silence per 20 ms frame (energy relative to the clip's own loud and quiet levels);
//  - pauses: silent gaps of at least 350 ms between the first and the last word; long pauses: 2 s or more;
//  - intonation: the pitch of voiced frames (autocorrelation at 8 kHz, 75-400 Hz), its spread in semitones.
// The numbers are estimates for tracking change over time, not a lab measurement.
(function () {
  'use strict';
  const SR = 8000;          // analysis sample rate
  const HOP = 160;          // 20 ms
  const WIN = 320;          // 40 ms
  const MIN_PAUSE = 0.35;   // seconds
  const LONG_PAUSE = 2.0;

  function toMono8k(buf) {
    const ch = buf.numberOfChannels; const len = buf.length; const ratio = buf.sampleRate / SR;
    const out = new Float32Array(Math.floor(len / ratio));
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    for (let i = 0; i < out.length; i++) {
      const s = Math.floor(i * ratio); const e = Math.min(len, Math.floor((i + 1) * ratio));
      let acc = 0; let n = 0;
      for (let j = s; j < e; j++) { for (let c = 0; c < ch; c++) acc += data[c][j]; n += ch; }
      out[i] = n ? acc / n : 0;
    }
    return out;
  }

  function percentile(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0; }

  function pitchOf(x, start) {
    // Normalised autocorrelation over 75-400 Hz; returns Hz or 0 when the frame is not clearly voiced.
    const minLag = Math.floor(SR / 400); const maxLag = Math.ceil(SR / 75);
    let mean = 0; for (let i = 0; i < WIN; i++) mean += x[start + i]; mean /= WIN;
    let energy = 0; for (let i = 0; i < WIN; i++) { const v = x[start + i] - mean; energy += v * v; }
    if (energy <= 1e-9) return 0;
    let best = 0; let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0; let e2 = 0;
      for (let i = 0; i + lag < WIN; i++) { const a = x[start + i] - mean; const b = x[start + i + lag] - mean; acc += a * b; e2 += b * b; }
      const r = acc / Math.sqrt(energy * e2 + 1e-12);
      if (r > best) { best = r; bestLag = lag; }
    }
    return best > 0.55 && bestLag ? SR / bestLag : 0;
  }

  async function analyze(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const buf = await new Promise((resolve, reject) => {
        blob.arrayBuffer().then((ab) => {
          const p = ctx.decodeAudioData(ab, resolve, reject);
          if (p && p.then) p.then(resolve, reject);
        }, reject);
      });
      const x = toMono8k(buf);
      const frames = Math.floor((x.length - WIN) / HOP);
      if (frames < 20) return null;
      const db = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let acc = 0; const s = f * HOP;
        for (let i = 0; i < WIN; i++) acc += x[s + i] * x[s + i];
        db[f] = 10 * Math.log10(acc / WIN + 1e-10);
      }
      const sorted = Array.from(db).sort((a, b) => a - b);
      const floor = percentile(sorted, 0.1); const loud = percentile(sorted, 0.95);
      // Speech threshold: well above the noise floor, but not so high that soft word endings count as silence.
      const thr = Math.max(floor + 8, loud - 28);
      const voiced = Array.from(db, (v) => v > thr);
      // Smooth: fill 1-frame holes and drop 1-frame blips.
      for (let f = 1; f < frames - 1; f++) if (voiced[f - 1] && voiced[f + 1]) voiced[f] = true;
      for (let f = 1; f < frames - 1; f++) if (!voiced[f - 1] && !voiced[f + 1]) voiced[f] = false;
      const first = voiced.indexOf(true); const last = voiced.lastIndexOf(true);
      if (first < 0 || last <= first) return { speechSec: 0, speechRatio: 0, pauseCount: 0, pausesPerMin: 0, longPauses: 0 };
      const frameSec = HOP / SR;
      let speechFrames = 0; let pauses = 0; let longPauses = 0; let gap = 0;
      for (let f = first; f <= last; f++) {
        if (voiced[f]) {
          speechFrames++;
          if (gap) { const g = gap * frameSec; if (g >= MIN_PAUSE) pauses++; if (g >= LONG_PAUSE) longPauses++; gap = 0; }
        } else gap++;
      }
      const activeMin = Math.max(((last - first + 1) * frameSec) / 60, 1 / 60);
      // Intonation on the loudest voiced frames (every other frame is plenty).
      const pitches = [];
      for (let f = first; f <= last; f += 2) {
        if (!voiced[f] || db[f] < thr + 4) continue;
        const hz = pitchOf(x, f * HOP);
        if (hz) pitches.push(hz);
      }
      let pitchStdSt = null; let pitchMedianHz = null;
      if (pitches.length >= 30) {
        const ps = pitches.slice().sort((a, b) => a - b);
        pitchMedianHz = percentile(ps, 0.5);
        // Octave errors are common in autocorrelation: keep values within an octave of the median.
        const st = pitches.filter((p) => p > pitchMedianHz / 2 && p < pitchMedianHz * 2).map((p) => 12 * Math.log2(p / pitchMedianHz));
        const m = st.reduce((a, b) => a + b, 0) / st.length;
        pitchStdSt = Math.sqrt(st.reduce((a, b) => a + (b - m) * (b - m), 0) / st.length);
      }
      const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
      return {
        speechSec: r1(speechFrames * frameSec),
        speechRatio: r1((speechFrames / (last - first + 1)) * 100),
        pauseCount: pauses,
        pausesPerMin: r1(pauses / activeMin),
        longPauses,
        pitchStdSt: r1(pitchStdSt),
        pitchMedianHz: r1(pitchMedianHz),
      };
    } finally {
      if (ctx.close) ctx.close().catch(() => {});
    }
  }

  window.AudioMetrics = { analyze };
})();
